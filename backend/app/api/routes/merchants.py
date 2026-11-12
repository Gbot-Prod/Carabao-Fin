import os
from datetime import UTC, datetime, timedelta

import requests as _requests
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.order_history import OrderHistory
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
    MerchantDetailResponse,
    MerchantResponse,
    MerchantUpdate,
)
from app.schemas.merchant_performance import MerchantPerformanceResponse
from app.schemas.payout import (
    AvailablePayout,
    MerchantOrderResponse,
    PayoutBatchResponse,
    PayoutInfoResponse,
    PayoutInfoUpdate,
    ReceivingInstitution,
    TransactionSummary,
)
from app.schemas.produce import ProduceCreate, ProduceResponse, ProduceUpdate
from app.schemas.shopPage import ShopPageCreate, ShopPageResponse, ShopPageUpdate
from app.services import paymongo, r2_service
from app.services.account_suspension import merchant_is_public
from app.services.merchant_service import (
    find_deletion_blockers,
    get_active_merchant,
    soft_delete_merchant,
)
from app.services.order_status import (
    ACTIVE_ORDER_STATUSES,
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
    payout_info_problem,
    transfer_fee,
)
from app.services.produce_freshness import freshness_error, is_listed, ph_today
from app.services.produce_pricing import parse_tiers, pricing_error, serialize_tiers
from app.services.service_area import OUTSIDE_LUZON_DETAIL, is_luzon_region
from app.services.sms_service import notify_order_shipped
from app.utils.geocoding import _geocode

router = APIRouter(tags=["merchants"])


class MerchantOrderStatusUpdate(BaseModel):
    status: OrderStatus


def _get_leg_durations(coords: list[tuple[float, float]]) -> list[float] | None:
    """Calls Mapbox Directions and returns cumulative driving duration (seconds) from coords[0] to each subsequent coord."""
    token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    if not token or len(coords) < 2:
        return None
    coord_str = ";".join(f"{lng},{lat}" for lat, lng in coords)
    url = f"https://api.mapbox.com/directions/v5/mapbox/driving/{coord_str}"
    try:
        resp = _requests.get(
            url, params={"access_token": token, "overview": "false"}, timeout=10
        )
        if not resp.ok:
            print(f"[shipment-directions] Mapbox error {resp.status_code}")
            return None
        legs = resp.json().get("routes", [{}])[0].get("legs", [])
        cumulative, total = [], 0.0
        for leg in legs:
            total += leg.get("duration", 0.0)
            cumulative.append(total)
        return cumulative
    except Exception as exc:
        print(f"[shipment-directions] Exception: {exc}")
        return None


def _compute_and_store_route(db: Session, order: Order) -> None:
    """Compute ALNS route for order and store waypoints. Called when marking for shipping."""
    if not order.merchant:
        print(f"[route] Skipping route computation for order {order.id}: no merchant")
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
        print(
            f"[route] Skipping route computation for order {
                order.id
            }: no merchant location or address"
        )
        return

    merchant_address = ", ".join(part for part in whole_address if part)
    delivery_address = order.delivery_address

    if not delivery_address:
        # Try to get from order history user
        order_history = (
            db.query(OrderHistory)
            .filter(OrderHistory.id == order.order_history_id)
            .first()
        )
        if order_history:
            user = db.query(User).filter(User.id == order_history.user_id).first()
            if user:
                parts = [p for p in [user.address, user.city] if p]
                delivery_address = ", ".join(parts) if parts else None

    if not delivery_address:
        print(
            f"[route] Skipping route computation for order {
                order.id
            }: no delivery address"
        )
        return

    origin_coords = _geocode(merchant_address)
    dest_coords = _geocode(delivery_address)

    if not origin_coords:
        print(
            f"[route] Could not geocode merchant address for order {order.id}: {
                merchant_address!r
            }"
        )
        return

    if not dest_coords:
        print(
            f"[route] Could not geocode delivery address for order {order.id}: {
                delivery_address!r
            }"
        )
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
    print(
        f"[route] Computed and stored route for order {order.id} with {
            len(ordered_stops)
        } stops"
    )


@router.get("/merchants", response_model=list[MerchantResponse])
def list_merchants(db: Session = Depends(get_db)):
    return (
        db.query(Merchant)
        # MerchantResponse includes both; without this each merchant costs 2 queries.
        .options(
            selectinload(Merchant.shop_page),
            selectinload(Merchant.produces.and_(is_listed(ph_today()))),
        )
        .outerjoin(MerchantApplication, MerchantApplication.user_id == Merchant.user_id)
        .filter(
            merchant_is_public(),
            or_(
                MerchantApplication.id.is_(None),
                MerchantApplication.status != "rejected",
            ),
        )
        .order_by(Merchant.id.asc())
        .all()
    )


@router.get("/merchants/{merchant_id}", response_model=MerchantDetailResponse)
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

    response = MerchantDetailResponse.model_validate(merchant)
    owner = merchant.user
    if owner is not None:
        full_name = " ".join(
            part.strip() for part in (owner.first_name, owner.last_name) if part and part.strip()
        )
        response.owner_name = full_name or None
    return response


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
    if "region" in updates and not is_luzon_region(updates["region"]):
        raise HTTPException(status_code=400, detail=OUTSIDE_LUZON_DETAIL)
    for field, value in updates.items():
        setattr(merchant, field, value)

    db.commit()
    db.refresh(merchant)
    return merchant


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

    produce = Produce(
        merchant_id=merchant.id,
        **produce_in.model_dump(exclude={"price_tiers"}),
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
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(
            status_code=404, detail="Shop page not found — create one first"
        )

    if logo.content_type not in {"image/png", "image/jpeg", "image/jpg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Logo must be PNG, JPEG, or WebP")

    data = logo.file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Logo must be under 5 MB")
    try:
        url = r2_service.upload_shop_logo(
            merchant.id, data, logo.content_type or "image/jpeg", logo.filename or ""
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Image upload failed") from exc

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
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(
            status_code=404, detail="Shop page not found — create one first"
        )

    if banner.content_type not in {
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
    }:
        raise HTTPException(status_code=400, detail="Banner must be PNG, JPEG, or WebP")

    data = banner.file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Banner must be under 5 MB")
    try:
        url = r2_service.upload_banner(
            merchant.id,
            data,
            banner.content_type or "image/jpeg",
            banner.filename or "",
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Image upload failed") from exc

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

    if image.content_type not in {"image/png", "image/jpeg", "image/jpg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Image must be PNG, JPEG, or WebP")

    data = image.file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be under 5 MB")
    try:
        url = r2_service.upload_produce_image(
            merchant.id,
            produce_id,
            data,
            image.content_type or "image/jpeg",
            image.filename or "",
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Image upload failed") from exc

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
        raise HTTPException(
            status_code=502, detail="Could not load the bank list. Try again."
        ) from exc


@router.put("/merchants/me/payout-info", response_model=PayoutInfoResponse)
def update_my_payout_info(
    payload: PayoutInfoUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    values = payload.model_dump()
    values["bank_name"] = None
    if payload.payout_type == "bank":
        try:
            institutions = paymongo.list_receiving_institutions("instapay")
        except Exception as exc:
            raise HTTPException(
                status_code=502, detail="Could not verify the bank. Try again."
            ) from exc
        match = next((i for i in institutions if i["code"] == payload.bank_code), None)
        if match is None:
            raise HTTPException(
                status_code=422, detail="That bank can't receive InstaPay transfers"
            )
        values["bank_name"] = match["name"]

    info = get_payout_info(db, merchant.id)
    if not info:
        info = MerchantPayoutInfo(merchant_id=merchant.id, **values)
        db.add(info)
    else:
        for field, value in values.items():
            setattr(info, field, value)

    db.commit()
    db.refresh(info)
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

    problem = payout_info_problem(get_payout_info(db, merchant.id))
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
        buyer_name = " ".join(filter(None, [user.first_name, user.last_name])) or None
    return MerchantOrderResponse(
        id=order.id,
        status=order.status,
        payment_status=payment_status(order),
        total_price=order.total_price,
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
    rows = (
        db.query(Order, User)
        .options(selectinload(Order.transactions))
        .outerjoin(User, User.id == Order.user_id)
        .filter(Order.merchant_id == merchant.id, money_received_clause())
        .order_by(Order.ordered_at.desc())
        .limit(200)
        .all()
    )

    return [
        _to_merchant_order_response(order, user) for order, user in rows
    ]


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

    order_history = (
        db.query(OrderHistory).filter(OrderHistory.id == order.order_history_id).first()
    )
    user = (
        db.query(User).filter(User.id == order_history.user_id).first()
        if order_history
        else None
    )

    notify_order_shipped(
        phone_number=user.phone_number if user else None,
        merchant_name=merchant.merchant_name or "Merchant",
        order_ref=f"CB-{order.ordered_at.year if order.ordered_at else 'XXXX'}-{order.id:04d}",
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
