import logging
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, raiseload, selectinload

from app.api.dependencies import get_current_user, get_db
from app.core.errors import upstream_error
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.merchant_payout import MerchantPayoutInfo, PayoutDestinationChange
from app.models.order import Order
from app.models.payout_batch import PayoutBatch, PayoutBatchItem
from app.models.produce import Produce
from app.models.shopPage import ShopPage
from app.models.statuses import (
    OPEN_PAYOUT_STATUSES,
    OrderStatus,
    PayoutStatus,
)
from app.models.transaction import Transaction
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
    AvailablePayout,
    MerchantOrderResponse,
    PayoutBatchResponse,
    PayoutCodeSent,
    PayoutInfoChange,
    PayoutInfoResponse,
    PayoutInfoUpdate,
    ReceivingInstitution,
    TransactionSummary,
)
from app.schemas.produce import ProduceCreate, ProduceResponse, ProduceUpdate
from app.schemas.shopPage import ShopPageCreate, ShopPageResponse, ShopPageUpdate
from app.services import (
    mapbox_routing,
    notifications,
    paymongo,
    payout_otp,
    r2_service,
    rate_limit,
    store_pause,
    upload_validation,
)
from app.services.account_suspension import merchant_is_public
from app.services.merchant_service import (
    find_deletion_blockers,
    get_active_merchant,
    soft_delete_merchant,
)
from app.services.order_status import (
    ACTIVE_ORDER_STATUSES,
    CLOSED_ORDER_STATUSES,
    SHIPPED_STATUSES,
    InvalidTransition,
    PaymentInProgress,
    apply_merchant_transition,
    auto_confirm_at,
    money_received_clause,
    payment_status,
)
from app.services.payout_service import (
    claimable_transactions,
    get_payout_info,
    move_failed_batches,
    payout_info_problem,
    resolve_destination,
    save_destination,
    transfer_fee,
)
from app.services.phone_verification import (
    changed_recently,
    normalize_ph_mobile,
    read_token,
)
from app.services.pinned_location import delivery_point, merchant_point, validate_pin
from app.services.produce_freshness import freshness_error, is_listed, ph_today
from app.services.produce_pricing import parse_tiers, pricing_error, serialize_tiers
from app.services.service_area import OUTSIDE_LUZON_DETAIL, is_luzon_region
from app.services.sms_service import notify_order_shipped
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

    model_config = ConfigDict(extra="forbid")  # CF-0063


def _compute_and_store_route(db: Session, order: Order) -> None:
    """Compute ALNS route for order and store waypoints. Called when marking for shipping."""
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
        logger.warning(
            "route: could not geocode merchant address, order %s", order.id
        )
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
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    updates = merchant_update.model_dump(exclude_unset=True)
    token = updates.pop("phone_verification_token", None)
    if "region" in updates and not is_luzon_region(updates["region"]):
        raise HTTPException(status_code=400, detail=OUTSIDE_LUZON_DETAIL)
    if "lat" in updates or "lng" in updates:
        validate_pin(updates.get("lat", merchant.lat), updates.get("lng", merchant.lng))
    if "contact_number" in updates:
        number = updates.pop("contact_number")
        _set_contact_number(merchant, current_user, number, token)
    for field, value in updates.items():
        setattr(merchant, field, value)

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

    total_orders = (
        db.query(func.count(Order.id)).filter(*paid_orders).scalar() or 0
    )
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
    last_order_at = (
        db.query(func.max(Order.ordered_at))
        .filter(*paid_orders)
        .scalar()
    )

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


@router.get("/merchants/me/produce", response_model=list[ProduceResponse])
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


@router.post("/produce/", response_model=ProduceResponse)
def create_produce(
    produce_in: ProduceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    error = freshness_error(produce_in.harvest_date, produce_in.best_before)
    error = error or pricing_error(
        produce_in.price, produce_in.min_order_qty, produce_in.price_tiers
    )
    if error:
        raise HTTPException(status_code=400, detail=error)
    # CF-0034: a new listing gets its photo from POST /produce/{id}/image.
    upload_validation.check_image_url_fields(
        {"image_url": produce_in.image_url}, {"image_url": None}
    )

    produce = Produce(
        merchant_id=merchant.id,
        **produce_in.model_dump(exclude={"price_tiers", "image_url"}),
        price_tiers=serialize_tiers(produce_in.price_tiers),
    )
    db.add(produce)
    db.commit()
    db.refresh(produce)
    return produce


@router.patch("/produce/{produce_id}", response_model=ProduceResponse)
def update_produce(
    produce_id: int,
    produce_update: ProduceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    produce = (
        db.query(Produce)
        .filter(Produce.id == produce_id, Produce.merchant_id == merchant.id)
        .first()
    )
    if not produce:
        raise HTTPException(status_code=404, detail="Produce item not found")

    changes = produce_update.model_dump(exclude_unset=True, exclude={"price_tiers"})
    upload_validation.check_image_url_fields(
        changes, {"image_url": produce.image_url}
    )
    if "image_url" in changes:
        changes["image_url"] = upload_validation.blank_to_none(changes["image_url"])
    for field, value in changes.items():
        setattr(produce, field, value)
    tiers = (
        produce_update.price_tiers
        if "price_tiers" in produce_update.model_fields_set
        else parse_tiers(produce.price_tiers)
    )
    produce.price_tiers = serialize_tiers(tiers)

    # An edited listing must carry valid dates, including one created before
    # they were collected, and tiers that still fit its price.
    error = freshness_error(produce.harvest_date, produce.best_before)
    error = error or pricing_error(produce.price, produce.min_order_qty, tiers)
    if error:
        db.rollback()
        raise HTTPException(status_code=400, detail=error)

    db.commit()
    db.refresh(produce)
    return produce


@router.delete("/produce/{produce_id}", status_code=204)
def delete_produce(
    produce_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
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
# ---------------------------------------------------------------------------


@router.get("/merchants/{merchant_id}/shoppage", response_model=ShopPageResponse)
def get_merchant_shoppage(merchant_id: int, db: Session = Depends(get_db)):
    shop_page = (
        db.query(ShopPage)
        .join(Merchant, Merchant.id == ShopPage.merchant_id)
        .filter(ShopPage.merchant_id == merchant_id, merchant_is_public())
        .first()
    )
    if not shop_page:
        raise HTTPException(status_code=404, detail="Shop page not found")
    return shop_page


@router.post("/merchants/me/shoppage", response_model=ShopPageResponse)
def create_my_shoppage(
    shop_page_in: ShopPageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    if merchant.shop_page:
        raise HTTPException(
            status_code=400, detail="Shop page already exists — use PATCH to update"
        )

    existing_slug = (
        db.query(ShopPage).filter(ShopPage.slug == shop_page_in.slug).first()
    )
    if existing_slug:
        raise HTTPException(status_code=400, detail="Slug already taken")

    shop_page = ShopPage(merchant_id=merchant.id, **shop_page_in.model_dump())
    db.add(shop_page)
    db.commit()
    db.refresh(shop_page)
    return shop_page


@router.patch("/merchants/me/shoppage", response_model=ShopPageResponse)
def update_my_shoppage(
    shop_page_update: ShopPageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(
            status_code=404, detail="Shop page not found — create one first with POST"
        )

    updates = shop_page_update.model_dump(exclude_unset=True)
    if "slug" in updates:
        existing = (
            db.query(ShopPage)
            .filter(ShopPage.slug == updates["slug"], ShopPage.id != shop_page.id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Slug already taken")

    upload_validation.check_image_url_fields(
        updates,
        {
            "banner_image_url": shop_page.banner_image_url,
            "logo_url": shop_page.logo_url,
        },
    )
    for field in ("banner_image_url", "logo_url"):
        if field in updates:
            updates[field] = upload_validation.blank_to_none(updates[field])
    for field, value in updates.items():
        setattr(shop_page, field, value)

    db.commit()
    db.refresh(shop_page)
    return shop_page


@router.post("/merchants/me/shoppage/logo", response_model=ShopPageResponse)
def upload_my_shoppage_logo(
    logo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "image_upload", str(current_user.id))  # CF-0060
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(
            status_code=404, detail="Shop page not found — create one first"
        )

    checked = upload_validation.check_image_upload(logo, "Logo")
    try:
        url = r2_service.upload_shop_logo(merchant.id, checked)
    except Exception as exc:
        raise upstream_error(
            502, "Image upload failed", log="R2 image upload failed", exc=exc
        ) from exc

    shop_page.logo_url = url
    db.commit()
    db.refresh(shop_page)
    return shop_page


@router.post("/merchants/me/shoppage/banner", response_model=ShopPageResponse)
def upload_my_shoppage_banner(
    banner: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "image_upload", str(current_user.id))  # CF-0060
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(
            status_code=404, detail="Shop page not found — create one first"
        )

    checked = upload_validation.check_image_upload(banner, "Banner")
    try:
        url = r2_service.upload_banner(merchant.id, checked)
    except Exception as exc:
        raise upstream_error(
            502, "Image upload failed", log="R2 image upload failed", exc=exc
        ) from exc

    shop_page.banner_image_url = url
    db.commit()
    db.refresh(shop_page)
    return shop_page


@router.post("/produce/{produce_id}/image", response_model=ProduceResponse)
def upload_produce_image(
    produce_id: int,
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "image_upload", str(current_user.id))  # CF-0060
    merchant = get_active_merchant(db, current_user.id)
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
    try:
        url = r2_service.upload_produce_image(merchant.id, produce_id, checked)
    except Exception as exc:
        raise upstream_error(
            502, "Image upload failed", log="R2 image upload failed", exc=exc
        ) from exc

    produce.image_url = url
    db.commit()
    db.refresh(produce)
    return produce


# ---------------------------------------------------------------------------
# Payout routes (merchant-facing)
# ---------------------------------------------------------------------------


@router.get("/merchants/me/payout-info", response_model=PayoutInfoResponse | None)
def get_my_payout_info(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return get_payout_info(db, merchant.id)


@router.get(
    "/merchants/me/payout-institutions", response_model=list[ReceivingInstitution]
)
def list_payout_institutions(current_user: User = Depends(get_current_user)):
    """Banks a payout can be sent to (PayMongo's InstaPay list)."""
    try:
        return paymongo.list_receiving_institutions("instapay")
    except Exception as exc:
        raise upstream_error(
            502,
            "Could not load the bank list. Try again.",
            log="PayMongo receiving institutions failed",
            exc=exc,
        ) from exc


def _payout_values(payload: PayoutInfoUpdate) -> dict:
    """The validated payout method to save, with the bank's name looked up."""
    values = payload.model_dump(include=set(PayoutInfoUpdate.model_fields))
    values["bank_name"] = None
    if payload.payout_type == "bank":
        try:
            institutions = paymongo.list_receiving_institutions("instapay")
        except Exception as exc:
            raise upstream_error(
                502,
                "Could not verify the bank. Try again.",
                log="PayMongo receiving institutions failed",
                exc=exc,
            ) from exc
        match = next((i for i in institutions if i["code"] == payload.bank_code), None)
        if match is None:
            raise HTTPException(
                status_code=422, detail="That bank can't receive InstaPay transfers"
            )
        values["bank_name"] = match["name"]
    return values


_PAYOUT_FIELDS = (
    "payout_type",
    "bank_code",
    "bank_name",
    "account_number",
    "account_name",
    "ewallet_number",
)


def _payout_snapshot(info: MerchantPayoutInfo | None) -> dict | None:
    if info is None:
        return None
    return {field: getattr(info, field) for field in _PAYOUT_FIELDS}


@router.post("/merchants/me/payout-info/code", response_model=PayoutCodeSent)
def send_payout_info_code(
    payload: PayoutInfoUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """CF-0004: text a code that confirms exactly this payout method."""
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    values = _payout_values(payload)
    sent_to = payout_otp.send_code(db, request, current_user, values)
    return PayoutCodeSent(sent_to=sent_to)


@router.put("/merchants/me/payout-info", response_model=PayoutInfoResponse)
def update_my_payout_info(
    payload: PayoutInfoChange,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save a payout method confirmed with its SMS code (CF-0004).

    Writes an audit row, moves failed payouts to the new method (requested
    ones keep theirs) and alerts the merchant's contacts on file.
    """
    # CF-0024: the PayMongo call and the code check (which commits) come
    # first. The row lock is then held only for the write, until one commit.
    if not get_active_merchant(db, current_user.id):
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    values = _payout_values(payload)
    payout_otp.check_code(db, request, current_user, values, payload.code)
    merchant = get_active_merchant(db, current_user.id, for_update=True)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    info = get_payout_info(db, merchant.id)
    before = _payout_snapshot(info)
    if not info:
        info = MerchantPayoutInfo(merchant_id=merchant.id, **values)
        db.add(info)
    else:
        for field, value in values.items():
            setattr(info, field, value)

    moved = move_failed_batches(db, merchant.id, resolve_destination(info))
    db.add(
        PayoutDestinationChange(
            merchant_id=merchant.id,
            user_id=current_user.id,
            before=before,
            after={**_payout_snapshot(info), "failed_batches_moved": moved},
            confirmed_via=payout_otp.account_number(current_user)[-4:],
            ip_address=rate_limit.client_ip(request),
        )
    )
    label = payout_otp.describe(values)
    notifications.notify(
        db,
        current_user.id,
        notifications.PAYOUT_DESTINATION_CHANGED,
        "Payout account changed",
        f"Payouts now go to {label}. If this was not you, contact support now.",
        "/merchantDashboard",
    )
    db.commit()
    db.refresh(info)
    if before is not None:
        payout_otp.alert_contacts(
            current_user, merchant, old=payout_otp.describe(before), new=label
        )
    return info


@router.get("/merchants/me/payouts", response_model=list[PayoutBatchResponse])
def get_my_payouts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return (
        db.query(PayoutBatch)
        .filter(PayoutBatch.merchant_id == merchant.id)
        .order_by(PayoutBatch.created_at.desc())
        .all()
    )


@router.get("/merchants/me/transactions", response_model=list[TransactionSummary])
def get_my_transactions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    rows = (
        db.query(Transaction, Order.status)
        .outerjoin(Order, Order.id == Transaction.order_id)
        .filter(Transaction.merchant_id == merchant.id)
        .order_by(Transaction.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        TransactionSummary.model_validate(txn).model_copy(
            update={"order_status": order_status}
        )
        for txn, order_status in rows
    ]


@router.get("/merchants/me/payouts/available", response_model=AvailablePayout)
def get_my_available_payout(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """What a cash out would request right now, and what would land after fees."""
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    txns = claimable_transactions(db, merchant.id)
    gross = sum(t.merchant_amount for t in txns)
    fee = transfer_fee()
    return AvailablePayout(
        transaction_count=len(txns),
        gross_amount=gross,
        transfer_fee=fee,
        net_amount=max(0, gross - fee),
    )


@router.post("/merchants/me/payouts/request", response_model=PayoutBatchResponse)
def request_my_payout(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # The row lock makes a concurrent request wait, then see this one as pending.
    merchant = get_active_merchant(db, current_user.id, for_update=True)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    info = get_payout_info(db, merchant.id)
    problem = payout_info_problem(info)
    if problem:
        raise HTTPException(status_code=400, detail=problem)

    pending = (
        db.query(PayoutBatch)
        .filter(
            PayoutBatch.merchant_id == merchant.id,
            PayoutBatch.status.in_(OPEN_PAYOUT_STATUSES),
        )
        .first()
    )
    if pending:
        raise HTTPException(
            status_code=400, detail="You already have a pending payout request"
        )

    unpaid_txns = claimable_transactions(db, merchant.id)
    if not unpaid_txns:
        raise HTTPException(
            status_code=400,
            detail="No delivered orders with unpaid earnings to cash out",
        )

    total = sum(t.merchant_amount for t in unpaid_txns)
    fee = transfer_fee()
    if total <= fee:
        raise HTTPException(
            status_code=400,
            detail=f"Earnings of ₱{total} don't cover the ₱{fee} transfer fee yet",
        )

    batch = PayoutBatch(
        merchant_id=merchant.id,
        period_date=datetime.now(UTC).date(),
        transaction_count=len(unpaid_txns),
        gross_amount=total,
        transfer_fee=fee,
        net_amount=total - fee,
        status=PayoutStatus.PENDING,
    )
    # CF-0004: fixed now; sending never reads the payout method again.
    save_destination(batch, resolve_destination(info))
    db.add(batch)
    db.flush()

    for txn in unpaid_txns:
        db.add(
            PayoutBatchItem(
                batch_id=batch.id, transaction_id=txn.id, amount=txn.merchant_amount
            )
        )

    db.commit()
    db.refresh(batch)
    return batch


# ---------------------------------------------------------------------------
# Merchant order management
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
    merchant = get_active_merchant(db, current_user.id)
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
        apply_merchant_transition(order, status, db)
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

    notify_order_shipped(
        # U5: only when the buyer accepts SMS updates.
        phone_number=user.phone_number if user and notifications.wants(user, "sms") else None,
        merchant_name=merchant.merchant_name or "Merchant",
        order_ref=notifications.order_ref(order),
        status=status,
    )

    return _to_merchant_order_response(order, user)


@router.delete("/merchants/me", status_code=204)
def delete_my_merchant(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # The row lock makes checkout wait, so no order can slip in between the
    # blocker check and the delete.
    merchant = get_active_merchant(db, current_user.id, for_update=True)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

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

    soft_delete_merchant(db, merchant)
    db.commit()
