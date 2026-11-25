import dataclasses
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, raiseload, selectinload

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchant_payouts, merchant_shop
from app.core.errors import FieldErrors, upstream_error
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.order import Order
from app.models.produce import Produce
from app.models.statuses import (
    OrderStatus,
    ProduceStatus,
)
from app.models.user import User
from app.routing.service import compute_route
from app.routing.state import Stop
from app.schemas.merchant import (
    MerchantResponse,
    MerchantUpdate,
    PublicMerchantDetailResponse,
    PublicMerchantResponse,
    StorePauseIn,
)
from app.schemas.merchant_performance import MerchantPerformanceResponse
from app.schemas.pagination import MAX_OFFSET
from app.schemas.payout import (
    MerchantOrderResponse,
)
from app.schemas.produce import (
    ListingStandingResponse,
    MerchantProduceResponse,
    ProduceCheckRequest,
    ProduceCheckResponse,
    ProduceCreate,
    ProduceResponse,
    ProduceUpdate,
)
from app.schemas.user import (
    AccountDeleteCodeRequest,
    AccountDeleteCodeSent,
    AccountDeleteConfirm,
)
from app.services import (
    account_deletion_otp,
    address_log,
    listing_checks,
    listing_reports,
    listing_trust,
    listing_vision,
    mapbox_routing,
    notifications,
    photo_checks,
    pin_area,
    psgc,
    r2_service,
    rate_limit,
    store_pause,
    upload_validation,
)
from app.services.account_suspension import merchant_is_public
from app.services.merchant_service import (
    find_deletion_blockers,
    get_active_merchant,
    get_editable_merchant,
    soft_delete_merchant,
)
from app.services.order_status import (
    ACTIVE_ORDER_STATUSES,
    CLOSED_ORDER_STATUSES,
    MERCHANT_CANCEL_NOTE_MAX,
    MERCHANT_CANCEL_REASONS,
    SHIPPED_STATUSES,
    InvalidTransition,
    PaymentInProgress,
    apply_merchant_transition,
    auto_confirm_at,
    merchant_cancel_text,
    money_received_clause,
    payment_status,
)
from app.services.phone_verification import (
    changed_recently,
    normalize_ph_mobile,
    read_token,
)
from app.services.pinned_location import (
    delivery_point,
    merchant_point,
    pin_update,
)
from app.services.produce_freshness import is_listed, ph_today
from app.services.produce_pricing import parse_tiers, serialize_tiers
from app.services.sms_service import notify_order_cancelled, notify_order_shipped
from app.utils.geocoding import _geocode

logger = logging.getLogger(__name__)

router = APIRouter(tags=["merchants"])


# CF-0059: one copy of the Mapbox call, in services/mapbox_routing.
_get_leg_durations = mapbox_routing.leg_durations


# CF-0073: closed orders shown in the merchant Orders tab (open ones: all).
MERCHANT_CLOSED_ORDERS_SHOWN = 200
# CF-0062: largest window of GET /merchants?limit=.
MAX_PUBLIC_FARMS_PAGE = 500


class MerchantOrderStatusUpdate(BaseModel):
    status: OrderStatus
    # Required to cancel (one of MERCHANT_CANCEL_REASONS); "other" needs a note.
    cancel_reason: str | None = None
    cancel_note: str | None = Field(default=None, max_length=MERCHANT_CANCEL_NOTE_MAX)

    model_config = ConfigDict(extra="forbid")  # CF-0063


def _cancel_text(body: MerchantOrderStatusUpdate) -> str | None:
    """The buyer-facing cancel reason, or None when not cancelling. 422 if missing."""
    if body.status != OrderStatus.CANCELLED:
        if body.cancel_reason or body.cancel_note:
            raise HTTPException(
                status_code=422, detail="A cancel reason is only sent when cancelling"
            )
        return None
    if body.cancel_reason not in MERCHANT_CANCEL_REASONS:
        raise HTTPException(
            status_code=422, detail="Choose why you are cancelling this order"
        )
    if body.cancel_reason == "other" and not (body.cancel_note or "").strip():
        raise HTTPException(
            status_code=422, detail="Tell the buyer why you are cancelling"
        )
    return merchant_cancel_text(body.cancel_reason, body.cancel_note)


def _compute_and_store_route(db: Session, order: Order) -> None:
    """Compute the ALNS route for ``order`` and store its waypoints.

    Called when the order is marked for shipping.
    """
    if not order.merchant:
        logger.info("route: skipping order %s, no merchant", order.id)
        return

    whole_address = [
        order.merchant.region,
        order.merchant.province,
        order.merchant.city,
        order.merchant.barangay,
        order.merchant.address,
        order.merchant.postal_code,
    ]

    if whole_address == [None, None, None, None, None, None]:
        logger.info("route: skipping order %s, no merchant address", order.id)
        return

    merchant_address = ", ".join(part for part in whole_address if part)
    delivery_address = order.delivery_address

    # Fall back to the buyer's default saved address.
    saved_address = order.user.default_address if order.user else None
    if not delivery_address and saved_address is not None:
        delivery_address = saved_address.short_line

    if not delivery_address and order.delivery_lat is None:
        logger.info("route: skipping order %s, no delivery address", order.id)
        return

    # Saved map pins first (U1); geocode the address text only without one.
    origin_coords = merchant_point(order.merchant, merchant_address, _geocode)
    dest_coords = delivery_point(order, saved_address, delivery_address, _geocode)

    if not origin_coords:
        # No address text in the log: it is personal data (CF-0039).
        logger.warning("route: could not geocode merchant address, order %s", order.id)
        return

    if not dest_coords:
        logger.warning("route: could not geocode delivery address, order %s", order.id)
        return

    # Build stop and run ALNS
    customer_stop = Stop(
        order_id=order.id,
        merchant_id=order.merchant_id or -1,
        lat=dest_coords[0],
        lng=dest_coords[1],
    )

    ordered_stops = compute_route(
        stops=[customer_stop],
        depot_lat=origin_coords[0],
        depot_lng=origin_coords[1],
    )

    leg_durations = (
        _get_leg_durations(
            [
                (origin_coords[0], origin_coords[1]),
                (ordered_stops[0].lat, ordered_stops[0].lng),
            ]
        )
        if ordered_stops
        else None
    )
    now = datetime.now(UTC)
    arrival_at = now + timedelta(seconds=leg_durations[0]) if leg_durations else None

    merchant_name = order.merchant.merchant_name if order.merchant else "Merchant"
    order.route_waypoints = [
        {
            "sequence": 0,
            "order_id": None,
            "lat": origin_coords[0],
            "lng": origin_coords[1],
            "label": f"Pickup: {merchant_name}",
            "type": "pickup",
            "status": "pickup",
            **({"total_duration_seconds": leg_durations[0]} if leg_durations else {}),
        }
    ] + [
        {
            "sequence": i + 1,
            "order_id": order.id,
            "lat": s.lat,
            "lng": s.lng,
            "label": "Your Location",
            "type": "delivery",
            "status": "in_transit",
            **(
                {
                    "estimated_arrival_at": arrival_at.isoformat(),
                    "duration_seconds": leg_durations[0],
                }
                if arrival_at and leg_durations
                else {}
            ),
        }
        for i, s in enumerate(ordered_stops)
    ]
    if arrival_at:
        order.time_of_arrival = arrival_at
    logger.info("route: stored for order %s, %s stops", order.id, len(ordered_stops))


@router.get("/merchants", response_model=list[PublicMerchantResponse])
def list_merchants(
    # CF-0062 (B60): the browse page and the sitemap need no listings; false
    # sends every farm with `produces: []` and does not load them at all.
    include_produce: bool = Query(True),
    # Optional window, oldest farm first. Without a limit the whole list comes
    # back as before (the mobile app reads it so).
    limit: int | None = Query(None, ge=1, le=MAX_PUBLIC_FARMS_PAGE),
    offset: int = Query(0, ge=0, le=MAX_OFFSET),
    db: Session = Depends(get_db),
):
    # Slim: listings are never loaded; raiseload makes a stray access fail
    # loudly instead of costing one query per farm.
    produce_option = (
        selectinload(Merchant.produces.and_(is_listed(ph_today())))
        if include_produce
        else raiseload(Merchant.produces)
    )
    query = (
        db.query(Merchant)
        # The response includes both; without this each merchant costs 2 queries.
        .options(selectinload(Merchant.shop_page), produce_option)
        .outerjoin(MerchantApplication, MerchantApplication.user_id == Merchant.user_id)
        .filter(
            merchant_is_public(),
            or_(
                MerchantApplication.id.is_(None),
                MerchantApplication.status != "rejected",
            ),
        )
        .order_by(Merchant.id.asc())
    )
    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    rows = query.all()
    if include_produce:
        return rows
    return [_slim_public_farm(row) for row in rows]


_SLIM_FIELDS = tuple(
    name for name in PublicMerchantResponse.model_fields if name != "produces"
)


def _slim_public_farm(merchant: Merchant) -> PublicMerchantResponse:
    data = {name: getattr(merchant, name) for name in _SLIM_FIELDS}
    return PublicMerchantResponse.model_validate(
        {**data, "produces": []}, from_attributes=True
    )


# Declared before /merchants/{merchant_id}, which would read "me" as an id.
@router.get("/merchants/me", response_model=MerchantResponse)
def get_my_merchant(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Merchant:
    """The caller's own full farm profile (CF-0048): address, pin, legal name."""
    merchant = get_active_merchant(db, cast(int, current_user.id))
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return merchant


@router.get("/merchants/{merchant_id}", response_model=PublicMerchantDetailResponse)
def get_merchant(merchant_id: int, db: Session = Depends(get_db)):
    merchant = (
        db.query(Merchant)
        .options(
            selectinload(Merchant.user),
            selectinload(Merchant.produces.and_(is_listed(ph_today()))),
        )
        .filter(Merchant.id == merchant_id, merchant_is_public())
        .first()
    )
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant not found")

    response = PublicMerchantDetailResponse.model_validate(merchant)
    owner = merchant.user
    if owner is not None:
        response.owner_name = (owner.name or "").strip() or None
    return response


@router.put("/merchants/me/pause", response_model=MerchantResponse)
def pause_my_store(
    payload: StorePauseIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Merchant:
    """CF-0066 (B13): take no orders through ``paused_until`` (Manila)."""
    merchant = get_active_merchant(db, cast(int, current_user.id))
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    today = ph_today()
    if payload.paused_until < today:
        raise HTTPException(status_code=422, detail="Pick today or a later day.")
    if payload.paused_until > store_pause.latest_allowed(today):
        raise HTTPException(
            status_code=422,
            detail=(
                f"A break can last up to {store_pause.MAX_PAUSE_DAYS} days. "
                "For longer, hide your listings."
            ),
        )
    merchant.paused_until = payload.paused_until  # type: ignore[assignment]
    merchant.pause_message = payload.message or None  # type: ignore[assignment]
    db.commit()
    db.refresh(merchant)
    return merchant


@router.delete("/merchants/me/pause", response_model=MerchantResponse)
def resume_my_store(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Merchant:
    """CF-0066: take orders again now."""
    merchant = get_active_merchant(db, cast(int, current_user.id))
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    merchant.paused_until = None  # type: ignore[assignment]
    merchant.pause_message = None  # type: ignore[assignment]
    db.commit()
    db.refresh(merchant)
    return merchant


@router.patch("/merchants/me", response_model=MerchantResponse)
def update_my_merchant(
    merchant_update: MerchantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    location_keys = {
        *psgc.AREA_FIELDS,
        *psgc.CODE_FIELDS,
        "address",
        "postal_code",
        "lat",
        "lng",
        "pin_confirmed",
    }
    if location_keys & merchant_update.model_fields_set:
        # Pin quality item 3; first, because it commits the session.
        rate_limit.enforce_action(db, "address_write", str(current_user.id))
    merchant = get_editable_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    before = address_log.snapshot(merchant)
    updates = merchant_update.model_dump(exclude_unset=True)
    token = updates.pop("phone_verification_token", None)
    # Region to barangay must be one PSGC chain in Luzon (services/psgc.py).
    area_keys = (*psgc.AREA_FIELDS, *psgc.CODE_FIELDS)
    area_changed = any(key in updates for key in (*area_keys, "postal_code"))
    if area_changed:
        values = psgc.merged_area_values(merchant, updates)
        try:
            area = psgc.resolve_area(db, values)
            postal = psgc.check_postal_code(
                updates.get("postal_code", merchant.postal_code), area
            )
        except (psgc.AreaError, psgc.AreaListMissing) as exc:
            raise psgc.http_error(exc) from exc
        for key in area_keys:
            updates.pop(key, None)
        updates.update(area.columns(), postal_code=postal)
    pin_changed = pin_update(merchant, updates, strict=True)
    if "contact_number" in updates:
        number = updates.pop("contact_number")
        _set_contact_number(merchant, current_user, number, token)
    for field, value in updates.items():
        setattr(merchant, field, value)
    if area_changed or pin_changed:
        # The pin against the city/barangay polygons (services/pin_area.py).
        pin_area.apply(db, merchant, kind="merchant")
    address_log.record(
        db,
        user_id=current_user.id,
        target_type="merchant",
        target_id=merchant.id,
        action="update",
        before=before,
        after=address_log.snapshot(merchant),
    )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Another shop already uses that contact number"
        ) from exc
    db.refresh(merchant)
    return merchant


def _set_contact_number(
    merchant: Merchant, user: User, value: str | None, token: str | None
) -> None:
    """CF-0030: store the +639XXXXXXXXX form, and only with a code sent to it.

    The token comes from /sms/otp/verify, as in onboarding. Sending the
    number already on file changes nothing and needs no code. The old number
    is kept for the payout-change alert (CF-0019).
    """
    number = normalize_ph_mobile(value or "")
    if number is None:
        raise HTTPException(
            status_code=400,
            detail="Enter a Philippine mobile number, e.g. 0912 345 6789",
        )
    current = normalize_ph_mobile(merchant.contact_number or "")
    if number == current:
        return
    verified = read_token(token)
    if not (
        verified is not None
        and verified.get("purpose") == "merchant_phone"
        and verified.get("user_id") == user.id
        and verified.get("number") == number
    ):
        raise HTTPException(
            status_code=400, detail="Please verify your contact number first"
        )
    # CF-0032: a second change inside the alert window keeps the number from
    # before the first one, so a hijacked session cannot push the owner's
    # number out by verifying two numbers in a row.
    now = datetime.now(UTC)
    if not changed_recently(merchant.contact_number_changed_at, now):
        merchant.previous_contact_number = merchant.contact_number
    merchant.contact_number_changed_at = now
    merchant.contact_number = f"+{number}"


@router.get("/merchants/me/performance", response_model=MerchantPerformanceResponse)
def get_my_merchant_performance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    # Unpaid checkouts never reach the merchant, so they don't count here.
    paid_orders = (Order.merchant_id == merchant.id, money_received_clause())
    now = datetime.now(UTC)
    window_start = now - timedelta(days=30)

    total_products = (
        db.query(func.count(Produce.id))
        .filter(Produce.merchant_id == merchant.id)
        .scalar()
        or 0
    )

    total_orders = db.query(func.count(Order.id)).filter(*paid_orders).scalar() or 0
    active_orders = (
        db.query(func.count(Order.id))
        .filter(*paid_orders, Order.status.in_(ACTIVE_ORDER_STATUSES))
        .scalar()
        or 0
    )
    delivered_orders = (
        db.query(func.count(Order.id))
        .filter(*paid_orders, Order.status == OrderStatus.DELIVERED)
        .scalar()
        or 0
    )
    cancelled_orders = (
        db.query(func.count(Order.id))
        .filter(*paid_orders, Order.status == OrderStatus.CANCELLED)
        .scalar()
        or 0
    )

    total_revenue = (
        db.query(func.coalesce(func.sum(Order.total_price), 0))
        .filter(*paid_orders, Order.status != OrderStatus.CANCELLED)
        .scalar()
        or 0
    )
    last_order_at = db.query(func.max(Order.ordered_at)).filter(*paid_orders).scalar()

    last_30_days_orders = (
        db.query(func.count(Order.id))
        .filter(*paid_orders, Order.ordered_at >= window_start)
        .scalar()
        or 0
    )
    last_30_days_revenue = (
        db.query(func.coalesce(func.sum(Order.total_price), 0))
        .filter(
            *paid_orders,
            Order.ordered_at >= window_start,
            Order.status != OrderStatus.CANCELLED,
        )
        .scalar()
        or 0
    )

    return MerchantPerformanceResponse(
        merchant_id=merchant.id,
        merchant_name=merchant.merchant_name,
        verification_status=str(merchant.verification_status),
        rating=merchant.rating,
        rating_count=merchant.rating_count or 0,
        total_products=int(total_products),
        total_orders=int(total_orders),
        active_orders=int(active_orders),
        delivered_orders=int(delivered_orders),
        cancelled_orders=int(cancelled_orders),
        total_revenue=int(total_revenue),
        last_order_at=last_order_at,
        last_30_days_orders=int(last_30_days_orders),
        last_30_days_revenue=int(last_30_days_revenue),
    )


# ---------------------------------------------------------------------------
# Produce routes
# ---------------------------------------------------------------------------


@router.get("/merchants/me/produce", response_model=list[MerchantProduceResponse])
def list_my_produce(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every listing of the current merchant, expired ones included."""
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return (
        db.query(Produce)
        .filter(Produce.merchant_id == merchant.id)
        .order_by(Produce.id)
        .all()
    )


@router.get("/merchants/me/listing-standing", response_model=ListingStandingResponse)
def get_my_listing_standing(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Guardrails Phase 2: penalty points, the new-listing block, new-farm review."""
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return listing_trust.standing_view(listing_trust.standing(db, merchant.id))


@router.get("/merchants/{merchant_id}/produce", response_model=list[ProduceResponse])
def list_merchant_produce(merchant_id: int, db: Session = Depends(get_db)):
    """The listings buyers can see: expired produce is left out."""
    merchant = (
        db.query(Merchant)
        .filter(Merchant.id == merchant_id, merchant_is_public())
        .first()
    )
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return (
        db.query(Produce)
        .filter(Produce.merchant_id == merchant.id, is_listed(ph_today()))
        .order_by(Produce.id)
        .all()
    )


def _check_response(result: listing_checks.CheckResult) -> ProduceCheckResponse:
    return ProduceCheckResponse.model_validate(
        {
            "valid": result.valid,
            "has_hard_blocks": bool(result.hard_blocks),
            "has_soft_flags": bool(result.soft_flags),
            "recommended_status": result.recommended_status,
            "hard_blocks": [i.as_dict() for i in result.hard_blocks],
            "soft_flags": [i.as_dict() for i in result.soft_flags],
            "market_price": (
                dataclasses.asdict(result.market_price) if result.market_price else None
            ),
        }
    )


@router.post("/produce/check", response_model=ProduceCheckResponse)
def check_produce(
    payload: ProduceCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Guardrails Phase 1: the listing checker, for the form while the merchant types.

    Saves nothing. The save (POST /produce/, PATCH /produce/{id}) runs the same
    checks again.
    """
    rate_limit.enforce_action(db, "produce_check", str(current_user.id))
    merchant = get_editable_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    listing = listing_checks.ListingInput(
        **payload.model_dump(exclude={"produce_id", "price_tiers"}),
        price_tiers=tuple(payload.price_tiers),
    )
    result = listing_checks.check_listing(
        db,
        listing,
        merchant_id=merchant.id,
        exclude_produce_id=payload.produce_id,
    )
    return _check_response(result)


def _refuse_hard_blocks(db: Session, result: listing_checks.CheckResult) -> None:
    if result.hard_blocks:
        db.rollback()
        raise FieldErrors(result.field_errors())


def _send_for_review(produce: Produce, flags: list[dict]) -> None:
    produce.status = ProduceStatus.UNDER_REVIEW
    produce.review_flags = flags
    produce.submitted_for_review_at = datetime.now(UTC)


def _apply_check(
    db: Session,
    produce: Produce,
    result: listing_checks.CheckResult,
    *,
    material: bool = True,
) -> None:
    """Set the listing's status from a check with no hard blocks.

    New listing: soft flags -> under_review, else live. A rejected listing
    that is saved again goes to under_review. An under_review listing goes
    live when the edit cleared every flag. Phase 2 (services/listing_trust.py):
    a live listing with a material edit goes back to under_review when the
    check has a soft flag; a new merchant's listings always get a flag until
    an admin approved enough of them. Phase 3: an open buyer report keeps its
    flag, so an edit does not take the listing out of the queue. A hidden
    listing stays hidden: only an admin unhides it.
    """
    status = produce.status
    if status == ProduceStatus.HIDDEN:
        return
    if status == ProduceStatus.LIVE and not material:
        return  # stock or dates only: no new review
    flags = result.flags_json()
    if listing_trust.new_merchant_reviews_left(db, produce.merchant_id) > 0:
        flags.append(listing_trust.new_merchant_issue().as_dict())
    # Phase 3: an open buyer report keeps the listing in the queue.
    if produce.id is not None:
        flags = listing_reports.with_report_flag(db, produce.id, flags)
    # Phase 4: a vision result for this photo, name and category stays.
    flags = listing_vision.with_vision_flags(produce, flags)
    if status == ProduceStatus.REJECTED:
        _send_for_review(produce, flags)
        produce.rejection_code = None
        produce.rejection_reason = None
        return
    if status == ProduceStatus.UNDER_REVIEW:
        if flags:
            produce.review_flags = flags
        else:
            produce.status = ProduceStatus.LIVE
            produce.review_flags = []
            produce.submitted_for_review_at = None
        return
    # A new listing, or a live one with a material edit.
    if flags:
        _send_for_review(produce, flags)
    else:
        produce.status = ProduceStatus.LIVE
        produce.review_flags = []


@router.post("/produce/", response_model=MerchantProduceResponse)
def create_produce(
    produce_in: ProduceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_editable_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    # Guardrails Phase 2: too many penalty points block new listings.
    trust = listing_trust.standing(db, merchant.id)
    if not trust.can_create_listings:
        raise HTTPException(status_code=403, detail=listing_trust.blocked_detail(trust))

    # Guardrails Phase 1: hard blocks refuse the save (400 FieldErrors, one
    # message per field); soft flags send the listing to the admin queue.
    result = listing_checks.check_listing(
        db,
        listing_checks.ListingInput(
            **produce_in.model_dump(exclude={"price_tiers", "image_url"}),
            price_tiers=tuple(produce_in.price_tiers),
        ),
        merchant_id=merchant.id,
        require_dates=True,
    )
    _refuse_hard_blocks(db, result)
    # CF-0034: a new listing gets its photo from POST /produce/{id}/image.
    upload_validation.check_image_url_fields(
        {"image_url": produce_in.image_url}, {"image_url": None}
    )

    produce = Produce(
        merchant_id=merchant.id,
        **produce_in.model_dump(exclude={"price_tiers", "image_url"}),
        price_tiers=serialize_tiers(produce_in.price_tiers),
    )
    _apply_check(db, produce, result)
    db.add(produce)
    db.commit()
    db.refresh(produce)
    return produce


@router.patch("/produce/{produce_id}", response_model=MerchantProduceResponse)
def update_produce(
    produce_id: int,
    produce_update: ProduceUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_editable_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    # CF-0049: locked like checkout locks it, so a stock edit and a checkout
    # decrement cannot overwrite each other.
    produce = (
        db.query(Produce)
        .filter(Produce.id == produce_id, Produce.merchant_id == merchant.id)
        .with_for_update()
        .populate_existing()
        .first()
    )
    if not produce:
        raise HTTPException(status_code=404, detail="Produce item not found")

    expected = produce_update.expected_stock_quantity
    if (
        produce_update.stock_quantity is not None
        and expected is not None
        and expected != produce.stock_quantity
    ):
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                f"Stock changed to {produce.stock_quantity} since you opened this "
                "listing (orders came in or were cancelled). Check it and save again."
            ),
        )

    before = listing_trust.snapshot(produce)
    changes = produce_update.model_dump(
        exclude_unset=True, exclude={"price_tiers", "expected_stock_quantity"}
    )
    upload_validation.check_image_url_fields(changes, {"image_url": produce.image_url})
    if "image_url" in changes:
        changes["image_url"] = upload_validation.blank_to_none(changes["image_url"])
        if changes["image_url"] is None:
            # Phase 4: the photo is removed, and its hash and check with it.
            produce.image_phash = None
            produce.photo_check = None
    for field, value in changes.items():
        setattr(produce, field, value)
    tiers = (
        produce_update.price_tiers
        if "price_tiers" in produce_update.model_fields_set
        else parse_tiers(produce.price_tiers)
    )
    produce.price_tiers = serialize_tiers(tiers)

    # An edited listing must carry valid dates, including one created before
    # they were collected, and tiers that still fit its price. Guardrails
    # Phase 1: every edit goes through the full checker.
    result = listing_checks.check_listing(
        db,
        listing_checks.listing_input_from(produce, tiers),
        merchant_id=merchant.id,
        exclude_produce_id=produce.id,
        require_dates=True,
    )
    _refuse_hard_blocks(db, result)
    _apply_check(
        db, produce, result, material=listing_trust.is_material_edit(before, produce)
    )

    db.commit()
    db.refresh(produce)
    # Phase 4: a new name or category in the queue gets a new vision check.
    listing_vision.schedule(background_tasks, produce)
    return produce


@router.delete("/produce/{produce_id}", status_code=204)
def delete_produce(
    produce_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_editable_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    produce = (
        db.query(Produce)
        .filter(Produce.id == produce_id, Produce.merchant_id == merchant.id)
        .first()
    )
    if not produce:
        raise HTTPException(status_code=404, detail="Produce item not found")

    db.delete(produce)
    db.commit()


# ---------------------------------------------------------------------------
# ShopPage routes
#
# The merchant edits a draft (draft_* columns). Buyers see only the live
# columns, and only after the first publish. POST .../publish copies the
# draft to live; POST .../unpublish hides the shop from buyers again;
# POST .../discard copies live back to the draft.
# ---------------------------------------------------------------------------


@router.post("/produce/{produce_id}/image", response_model=MerchantProduceResponse)
def upload_produce_image(
    produce_id: int,
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "image_upload", str(current_user.id))  # CF-0060
    merchant = get_editable_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    produce = (
        db.query(Produce)
        .filter(Produce.id == produce_id, Produce.merchant_id == merchant.id)
        .first()
    )
    if not produce:
        raise HTTPException(status_code=404, detail="Produce item not found")

    checked = upload_validation.check_image_upload(image, "Image")
    # Guardrails Phase 4: a QR code is a hard block, before the photo is
    # stored; the pHash goes on the listing for the stolen-photo flag.
    facts = photo_checks.inspect(checked.data)
    photo_checks.refuse_qr_code(facts)
    try:
        url = r2_service.upload_produce_image(merchant.id, produce_id, checked)
    except Exception as exc:
        raise upstream_error(
            502, "Image upload failed", log="R2 image upload failed", exc=exc
        ) from exc

    before = listing_trust.snapshot(produce)
    produce.image_url = url
    produce.image_phash = facts.phash
    # Guardrails Phase 2: a new photo is a material edit, so check again. A
    # listing with hard blocks (made before a rule existed) keeps its status;
    # its next form save shows the blocks.
    result = listing_checks.check_listing(
        db,
        listing_checks.listing_input_from(produce, parse_tiers(produce.price_tiers)),
        merchant_id=merchant.id,
        exclude_produce_id=produce.id,
    )
    if not result.hard_blocks:
        _apply_check(
            db,
            produce,
            result,
            material=listing_trust.is_material_edit(before, produce),
        )
    db.commit()
    db.refresh(produce)
    # Phase 4: a listing in the queue gets a vision check of the new photo.
    listing_vision.schedule(background_tasks, produce)
    return produce


# ---------------------------------------------------------------------------
# Payout routes (merchant-facing)
# ---------------------------------------------------------------------------


def _to_merchant_order_response(
    order: Order, user: User | None
) -> MerchantOrderResponse:
    """One order as the merchant's orders tab shows it."""
    buyer_name = None
    if user:
        buyer_name = user.name or None
    return MerchantOrderResponse(
        id=order.id,
        status=order.status,
        payment_status=payment_status(order),
        total_price=order.total_price,
        delivery_fee=order.delivery_fee or 0,
        discount=order.discount or 0,
        voucher_code=order.voucher_code,
        items=order.items or [],
        delivery_address=order.delivery_address,
        ordered_at=order.ordered_at,
        buyer_name=buyer_name,
        buyer_email=user.email if user else None,
        buyer_phone=user.phone_number if user else None,
        shipped=order.status in SHIPPED_STATUSES,
        time_of_arrival=order.time_of_arrival,
        shipment_id=order.shipment_id,
        shipped_at=order.shipped_at,
        auto_confirm_at=auto_confirm_at(order),
        requested_delivery_date=order.requested_delivery_date,
        delivery_window=order.delivery_window,
        notes=order.notes,
        cancel_reason=order.cancel_reason,
    )


@router.get("/merchants/me/orders", response_model=list[MerchantOrderResponse])
def get_my_merchant_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    # Unpaid checkouts stay with the buyer until a payment lands on them.
    def paid_orders() -> Any:
        return (
            db.query(Order, User)
            .options(selectinload(Order.transactions))
            .outerjoin(User, User.id == Order.user_id)
            .filter(Order.merchant_id == merchant.id, money_received_clause())
        )

    closed = [s.value for s in CLOSED_ORDER_STATUSES]
    # CF-0073 (B80): every order the farm still has to pack, ship or deliver,
    # however old, plus the newest closed ones. A single "newest 200" let 200
    # newer delivered orders push an open one out of the tab.
    open_rows = paid_orders().filter(Order.status.notin_(closed)).all()
    closed_rows = (
        paid_orders()
        .filter(Order.status.in_(closed))
        .order_by(Order.ordered_at.desc(), Order.id.desc())
        .limit(MERCHANT_CLOSED_ORDERS_SHOWN)
        .all()
    )
    rows = sorted(
        open_rows + closed_rows,
        key=lambda r: (r[0].ordered_at or datetime.min.replace(tzinfo=UTC), r[0].id),
        reverse=True,
    )
    return [_to_merchant_order_response(order, user) for order, user in rows]


@router.patch(
    "/merchants/me/orders/{order_id}/status", response_model=MerchantOrderResponse
)
def update_my_merchant_order_status(
    order_id: int,
    body: MerchantOrderStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    status = body.status
    cancel_text = _cancel_text(body)
    merchant = get_editable_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    order = (
        db.query(Order)
        .filter(Order.id == order_id, Order.merchant_id == merchant.id)
        .with_for_update()
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    try:
        apply_merchant_transition(order, status, db, cancel_reason=cancel_text)
    except InvalidTransition as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PaymentInProgress as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    # Compute and store ALNS route when order is marked for shipping (first
    # time only)
    if status == OrderStatus.SHIPPED and not order.route_waypoints:
        _compute_and_store_route(db, order)

    db.commit()

    user = order.user
    # U5: only when the buyer accepts SMS updates.
    buyer_phone = (
        user.phone_number if user and notifications.wants(user, "sms") else None
    )

    notify_order_shipped(
        phone_number=buyer_phone,
        merchant_name=merchant.merchant_name or "Merchant",
        order_ref=notifications.order_ref(order),
        status=status,
    )
    if cancel_text:
        notify_order_cancelled(
            phone_number=buyer_phone,
            merchant_name=merchant.merchant_name or "Merchant",
            order_ref=notifications.order_ref(order),
            reason=cancel_text,
        )

    return _to_merchant_order_response(order, user)


def _refuse_merchant_delete_if_blocked(db: Session, merchant: Merchant) -> None:
    """409 naming what is still open (orders, refunds, payouts)."""
    blockers = find_deletion_blockers(db, merchant.id)
    if blockers:
        raise HTTPException(
            status_code=409,
            detail={
                "message": (
                    "Settle active orders, refunds and payouts before "
                    "deleting your merchant profile"
                ),
                "blockers": blockers,
            },
        )


@router.post("/merchants/me/delete-code", response_model=AccountDeleteCodeSent)
def send_merchant_delete_code(
    request: Request,
    payload: AccountDeleteCodeRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Text the code that confirms closing the merchant profile, after the
    account's password (when it has one), as for deleting the account
    (/users/me/delete-code). Refuses (409) first when the profile can't be
    closed, so no SMS is spent on it."""
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    _refuse_merchant_delete_if_blocked(db, merchant)
    account_deletion_otp.check_password(
        db, request, current_user, payload.password if payload else None
    )
    sent_to = account_deletion_otp.send_code(
        db, request, current_user, purpose="merchant"
    )
    return AccountDeleteCodeSent(sent_to=sent_to)


@router.delete("/merchants/me", status_code=204)
def delete_my_merchant(
    request: Request,
    payload: AccountDeleteConfirm = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Close the merchant profile, confirmed with the code from
    /merchants/me/delete-code. A session alone cannot close it."""
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    # Refuse before using up the code, so it still works once things settle.
    _refuse_merchant_delete_if_blocked(db, merchant)
    # check_code commits, so it runs before the row lock below is taken.
    account_deletion_otp.check_code(
        db, request, current_user, payload.code, purpose="merchant"
    )

    # The row lock makes checkout wait, so no order can slip in between the
    # blocker check and the delete.
    merchant = get_active_merchant(db, current_user.id, for_update=True)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    _refuse_merchant_delete_if_blocked(db, merchant)

    soft_delete_merchant(db, merchant)
    db.commit()


# CF-0079 (B24): split out of this file. Included here, after every route
# above, so `merchants.router` (the app and the tests use it) has the same
# routes in the same order for every path that two routes could both match.
router.include_router(merchant_shop.router)
router.include_router(merchant_payouts.router)
