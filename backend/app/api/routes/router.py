import os
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.security import create_access_token
from app.models.cart import Cart
from app.models.current_orders import CurrentOrder
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.produce import Produce
from app.models.user import User
from app.schemas.cart import CartResponse, CartUpdate
from app.schemas.merchant import MerchantBase, MerchantPageBase, MerchantResponse, MerchantUpdate
from app.schemas.order import CurrentOrderResponse, OrderItemResponse, PlaceOrderRequest, PlaceOrderResponse
from app.schemas.produce import ProduceCreate, ProduceResponse, ProduceUpdate
from app.schemas.shopPage import ShopPageCreate, ShopPageResponse, ShopPageUpdate
from app.schemas.user import UserResponse, UserUpdate
from app.models.shopPage import ShopPage
from app.services.email import send_email
from app.services.merchant_service import create_merchant

router = APIRouter()


class AuthSyncPayload(BaseModel):
    provider_user_id: str
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone_number: Optional[str] = None


class AuthSyncResponse(BaseModel):
    ok: bool
    user_id: int
    email: EmailStr
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 3600


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _compute_cart_totals(items: list[dict[str, Any]]) -> tuple[int, int]:
    total_items = 0
    total_price = 0
    for item in items:
        quantity = max(_to_int(item.get("quantity"), 0), 0)
        unit_price = max(_to_int(item.get("price"), 0), 0)
        total_items += quantity
        total_price += quantity * unit_price
    return total_items, total_price


def _get_or_create_cart(db: Session, user_id: int) -> Cart:
    cart = db.query(Cart).filter(Cart.user_id == user_id).first()
    if cart is not None:
        return cart

    cart = Cart(user_id=user_id, items=[], total_items=0, total_price=0)
    db.add(cart)
    db.commit()
    db.refresh(cart)
    return cart


def _get_order_history(db: Session, user_id: int) -> OrderHistory | None:
    return db.query(OrderHistory).filter(OrderHistory.user_id == user_id).first()


def _get_or_create_order_history(db: Session, user_id: int) -> OrderHistory:
    history = _get_order_history(db, user_id)
    if history is not None:
        return history

    history = OrderHistory(user_id=user_id, total_orders=0, total_spent=0)
    db.add(history)
    db.flush()
    return history


def _derive_merchant_name(items: list[dict[str, Any]] | None, fallback: str) -> str:
    if not items:
        return fallback
    first_item = items[0]
    if isinstance(first_item, dict):
        merchant_name = first_item.get("farm") or first_item.get("merchant")
        if merchant_name:
            return str(merchant_name)
    return fallback


def _extract_item_int(item: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = item.get(key)
        if value is None:
            continue
        parsed = _to_int(value, default=-1)
        if parsed > 0:
            return parsed
    return None


def _resolve_merchant_from_items(db: Session, items: list[dict[str, Any]] | None) -> Merchant | None:
    if not items:
        return None

    for raw_item in items:
        if not isinstance(raw_item, dict):
            continue

        merchant_id = _extract_item_int(raw_item, "merchant_id", "merchantId")
        if merchant_id is not None:
            merchant = db.query(Merchant).filter(Merchant.id == merchant_id).first()
            if merchant is not None:
                return merchant

        produce_id = _extract_item_int(raw_item, "produce_id", "produceId", "id")
        if produce_id is not None:
            produce = db.query(Produce).filter(Produce.id == produce_id).first()
            if produce is not None and produce.merchant is not None:
                return produce.merchant

        merchant_name = raw_item.get("merchant") or raw_item.get("farm")
        if isinstance(merchant_name, str) and merchant_name.strip():
            merchant = (
                db.query(Merchant)
                .filter(func.lower(Merchant.merchant_name) == merchant_name.strip().lower())
                .first()
            )
            if merchant is not None:
                return merchant

    return None


def _get_merchant_page_slug(merchant: Merchant | None) -> str | None:
    if merchant is None or merchant.shop_page is None:
        return None
    return merchant.shop_page.slug


def _to_order_history_item(order: Order) -> dict[str, Any]:
    items = order.items or []
    merchant = order.merchant
    return {
        "id": order.id,
        "order_id": order.id,
        "merchant": _derive_merchant_name(items, merchant.merchant_name if merchant is not None else f"Order #{order.id}"),
        "merchant_id": merchant.id if merchant is not None else None,
        "merchant_page_slug": _get_merchant_page_slug(merchant),
        "total_amount": order.total_price,
        "order_date": order.ordered_at,
        "status": order.status,
        "items": items,
    }


def _to_current_order_item_from_order(order: Order) -> dict[str, Any]:
    items = order.items or []
    first_item = items[0] if items and isinstance(items[0], dict) else {}
    merchant = order.merchant
    merchant_name = _derive_merchant_name(items, merchant.merchant_name if merchant is not None else f"Order #{order.id}")
    return {
        "id": order.id,
        "order_id": order.id,
        "merchant": merchant_name,
        "merchant_id": merchant.id if merchant is not None else None,
        "merchant_page_slug": _get_merchant_page_slug(merchant),
        "shipped": order.status.lower() in {"shipped", "out_for_delivery", "delivered"},
        "date_bought": order.ordered_at,
        "time_of_arrival": None,
        "delivery_fee": int(first_item.get("deliveryFee", 0) if isinstance(first_item, dict) else 0),
        "image": first_item.get("image") if isinstance(first_item, dict) else None,
        "status": order.status,
    }


def _to_current_order_item(current_order: CurrentOrder) -> dict[str, Any]:
    order = current_order.order
    items = order.items or []
    first_item = items[0] if items and isinstance(items[0], dict) else {}
    merchant = current_order.merchant or order.merchant
    return {
        "id": current_order.id,
        "order_id": current_order.order_id,
        "merchant": current_order.merchant_name,
        "merchant_id": merchant.id if merchant is not None else None,
        "merchant_page_slug": _get_merchant_page_slug(merchant),
        "shipped": current_order.shipped,
        "date_bought": order.ordered_at,
        "time_of_arrival": current_order.time_of_arrival,
        "delivery_fee": current_order.delivery_fee,
        "image": current_order.image or (first_item.get("image") if isinstance(first_item, dict) else None),
        "status": current_order.status,
    }

@router.get("/send-email")
async def send_email_route():
    return send_email()

@router.post("/merchant/", response_model=MerchantResponse)
async def create_merchant_route(merchant: MerchantPageBase, db: Session = Depends(get_db)):
    try:
        return create_merchant(db, merchant)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/merchants/me", response_model=MerchantResponse)
async def create_my_merchant_route(
    merchant: MerchantBase,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    payload = MerchantPageBase(user_id=current_user.id, **merchant.model_dump())
    try:
        return create_merchant(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/merchants", response_model=list[MerchantResponse])
async def list_merchants(db: Session = Depends(get_db)):
    return db.query(Merchant).order_by(Merchant.id.asc()).all()


@router.get("/merchants/{merchant_id}", response_model=MerchantResponse)
async def get_merchant(merchant_id: int, db: Session = Depends(get_db)):
    merchant = db.query(Merchant).filter(Merchant.id == merchant_id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return merchant


@router.patch("/merchants/me", response_model=MerchantResponse)
async def update_my_merchant(
    merchant_update: MerchantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    updates = merchant_update.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(merchant, field, value)

    db.commit()
    db.refresh(merchant)
    return merchant


@router.get("/users/me", response_model=UserResponse)
async def get_current_user_profile(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/users/me", response_model=UserResponse)
async def update_current_user_profile(
    user_update: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updates = user_update.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(current_user, field, value)

    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/carts/me", response_model=CartResponse)
async def get_my_cart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cart = _get_or_create_cart(db, current_user.id)
    return cart


@router.put("/carts/me", response_model=CartResponse)
async def replace_my_cart(
    cart_update: CartUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cart = _get_or_create_cart(db, current_user.id)
    update_data = cart_update.model_dump(exclude_unset=True)

    if "items" in update_data and update_data["items"] is not None:
        cart.items = update_data["items"]

    total_items, total_price = _compute_cart_totals(cart.items or [])
    cart.total_items = total_items
    cart.total_price = total_price

    db.commit()
    db.refresh(cart)
    return cart


@router.post("/orders/me/place", response_model=PlaceOrderResponse)
async def place_order_from_cart(
    payload: PlaceOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cart = _get_or_create_cart(db, current_user.id)
    cart_items = cart.items or []

    if not cart_items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    history = _get_or_create_order_history(db, current_user.id)
    merchant = _resolve_merchant_from_items(db, cart_items)
    service_fee = max(_to_int(payload.service_fee, 40), 0)
    total_price = max(_to_int(cart.total_price, 0), 0) + service_fee

    order = Order(
        order_history_id=history.id,
        merchant_id=merchant.id if merchant is not None else None,
        status="pending",
        total_price=total_price,
        items=cart_items,
    )
    db.add(order)
    db.flush()

    current_order = CurrentOrder(
        order_id=order.id,
        merchant_id=merchant.id if merchant is not None else None,
        merchant_name=_derive_merchant_name(cart_items, merchant.merchant_name if merchant is not None else f"Order #{order.id}"),
        status="pending",
        shipped=False,
        delivery_fee=service_fee,
        image=payload.image,
    )
    db.add(current_order)

    history.total_orders = _to_int(history.total_orders, 0) + 1
    history.total_spent = _to_int(history.total_spent, 0) + total_price
    history.last_order_at = datetime.now(timezone.utc)

    cart.items = []
    cart.total_items = 0
    cart.total_price = 0

    db.commit()
    db.refresh(order)

    ordered_year = order.ordered_at.year if order.ordered_at else 0
    order_reference = f"CB-{ordered_year}-{order.id:04d}"

    return PlaceOrderResponse(
        order_id=order.id,
        order_reference=order_reference,
        status=order.status,
    )


@router.get("/orders/me/history", response_model=list[OrderItemResponse])
async def get_my_order_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    history = _get_order_history(db, current_user.id)
    if history is None:
        return []

    orders = sorted(history.orders, key=lambda order: order.ordered_at, reverse=True)
    return [_to_order_history_item(order) for order in orders]


@router.get("/orders/me/current", response_model=list[CurrentOrderResponse])
async def get_my_current_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_orders = (
        db.query(CurrentOrder)
        .join(Order)
        .join(OrderHistory)
        .filter(OrderHistory.user_id == current_user.id)
        .order_by(CurrentOrder.id.asc())
        .all()
    )

    if current_orders:
        return [_to_current_order_item(current_order) for current_order in current_orders]

    history = _get_order_history(db, current_user.id)
    if history is None:
        return []

    active_statuses = {"pending", "processing", "shipped", "out_for_delivery"}
    active_orders = [
        order
        for order in sorted(history.orders, key=lambda item: item.ordered_at, reverse=True)
        if order.status.lower() in active_statuses
    ]
    return [_to_current_order_item_from_order(order) for order in active_orders]


@router.post("/auth/sync")
async def sync_auth(
    payload: AuthSyncPayload,
    db: Session = Depends(get_db),
    x_internal_auth_sync_secret: Optional[str] = Header(
        default=None,
        alias="X-Internal-Auth-Sync-Secret",
    ),
) -> AuthSyncResponse:
    expected_secret = os.getenv("AUTH_SYNC_SHARED_SECRET")
    if not expected_secret:
        raise HTTPException(
            status_code=500,
            detail="AUTH_SYNC_SHARED_SECRET is not configured",
        )

    if x_internal_auth_sync_secret != expected_secret:
        raise HTTPException(status_code=401, detail="Unauthorized auth sync request")

    user = db.query(User).filter(User.external_auth_id == payload.provider_user_id).first()

    # Fallback by email so existing users can be linked to Better Auth without duplicates.
    if user is None:
        user = db.query(User).filter(User.email == payload.email).first()

    if user is None:
        user = User(
            external_auth_id=payload.provider_user_id,
            email=payload.email,
            first_name=payload.first_name,
            last_name=payload.last_name,
            phone_number=payload.phone_number,
        )
        db.add(user)
    else:
        user.external_auth_id = payload.provider_user_id
        user.email = payload.email
        user.first_name = payload.first_name
        user.last_name = payload.last_name
        user.phone_number = payload.phone_number

    db.commit()
    db.refresh(user)

    access_token = create_access_token(subject=user.external_auth_id, expires_minutes=60)
    return AuthSyncResponse(
        ok=True,
        user_id=user.id,
        email=user.email,
        access_token=access_token,
    )


@router.get("/auth/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "external_auth_id": current_user.external_auth_id,
        "email": current_user.email,
        "first_name": current_user.first_name,
        "last_name": current_user.last_name,
        "phone_number": current_user.phone_number,
    }


# ---------------------------------------------------------------------------
# Produce routes
# ---------------------------------------------------------------------------

@router.get("/merchants/{merchant_id}/produce", response_model=list[ProduceResponse])
async def list_merchant_produce(merchant_id: int, db: Session = Depends(get_db)):
    merchant = db.query(Merchant).filter(Merchant.id == merchant_id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return merchant.produces


@router.post("/produce/", response_model=ProduceResponse)
async def create_produce(
    produce_in: ProduceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    produce = Produce(merchant_id=merchant.id, **produce_in.model_dump())
    db.add(produce)
    db.commit()
    db.refresh(produce)
    return produce


@router.patch("/produce/{produce_id}", response_model=ProduceResponse)
async def update_produce(
    produce_id: int,
    produce_update: ProduceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    produce = db.query(Produce).filter(Produce.id == produce_id, Produce.merchant_id == merchant.id).first()
    if not produce:
        raise HTTPException(status_code=404, detail="Produce item not found")

    for field, value in produce_update.model_dump(exclude_unset=True).items():
        setattr(produce, field, value)

    db.commit()
    db.refresh(produce)
    return produce


@router.delete("/produce/{produce_id}", status_code=204)
async def delete_produce(
    produce_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    produce = db.query(Produce).filter(Produce.id == produce_id, Produce.merchant_id == merchant.id).first()
    if not produce:
        raise HTTPException(status_code=404, detail="Produce item not found")

    db.delete(produce)
    db.commit()


# ---------------------------------------------------------------------------
# Merchant order queue routes
# ---------------------------------------------------------------------------

ACTIVE_ORDER_STATUSES = {"pending", "processing", "shipped", "out_for_delivery"}
VALID_ORDER_STATUSES = {"pending", "processing", "shipped", "out_for_delivery", "delivered", "cancelled"}


@router.get("/orders/merchant/current", response_model=list[CurrentOrderResponse])
async def get_merchant_current_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    current_orders = (
        db.query(CurrentOrder)
        .filter(
            CurrentOrder.merchant_id == merchant.id,
            CurrentOrder.status.in_(ACTIVE_ORDER_STATUSES),
        )
        .order_by(CurrentOrder.created_at.asc())
        .all()
    )
    return [_to_current_order_item(co) for co in current_orders]


@router.patch("/orders/{order_id}/status")
async def update_order_status(
    order_id: int,
    status: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=403, detail="Only merchants can update order status")

    if status not in VALID_ORDER_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_ORDER_STATUSES))}")

    order = db.query(Order).filter(Order.id == order_id, Order.merchant_id == merchant.id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.status = status
    if order.current_order:
        order.current_order.status = status
        order.current_order.shipped = status in {"shipped", "out_for_delivery", "delivered"}

    db.commit()
    return {"order_id": order_id, "status": status}


# ---------------------------------------------------------------------------
# Dummy tracking route (testing only)
# ---------------------------------------------------------------------------

import math
import time

# Simulated delivery route: Bulacan farm → Quezon City → Makati (Manila area)
_DUMMY_WAYPOINTS = [
    (14.7942, 120.8788),  # Bulacan (origin/farm)
    (14.7500, 120.9200),
    (14.7000, 120.9800),
    (14.6700, 121.0200),
    (14.6400, 121.0500),
    (14.6200, 121.0500),
    (14.5800, 121.0400),
    (14.5500, 121.0200),
    (14.5300, 121.0100),
    (14.5100, 121.0000),
    (14.4900, 121.0100),  # Makati (destination)
]

_CYCLE_SECONDS = 120  # full route completes in 2 minutes for testing


class TrackingPosition(BaseModel):
    lat: float
    lng: float


class TrackingResponse(BaseModel):
    order_id: int
    origin: TrackingPosition
    destination: TrackingPosition
    current_position: TrackingPosition
    waypoints: list[TrackingPosition]
    progress: float
    eta_minutes: int


@router.get("/tracking/{order_id}", response_model=TrackingResponse)
async def get_dummy_tracking(order_id: int):
    elapsed = time.time() % _CYCLE_SECONDS
    progress = elapsed / _CYCLE_SECONDS  # 0.0 → 1.0

    waypoints = _DUMMY_WAYPOINTS
    total_segments = len(waypoints) - 1
    scaled = progress * total_segments
    segment_index = min(int(scaled), total_segments - 1)
    segment_progress = scaled - segment_index

    lat1, lng1 = waypoints[segment_index]
    lat2, lng2 = waypoints[segment_index + 1]
    current_lat = lat1 + (lat2 - lat1) * segment_progress
    current_lng = lng1 + (lng2 - lng1) * segment_progress

    remaining = 1.0 - progress
    eta_minutes = math.ceil(remaining * _CYCLE_SECONDS / 60)

    origin_lat, origin_lng = waypoints[0]
    dest_lat, dest_lng = waypoints[-1]

    return TrackingResponse(
        order_id=order_id,
        origin=TrackingPosition(lat=origin_lat, lng=origin_lng),
        destination=TrackingPosition(lat=dest_lat, lng=dest_lng),
        current_position=TrackingPosition(lat=current_lat, lng=current_lng),
        waypoints=[TrackingPosition(lat=lat, lng=lng) for lat, lng in waypoints],
        progress=round(progress, 4),
        eta_minutes=eta_minutes,
    )


# ---------------------------------------------------------------------------
# ShopPage routes
# ---------------------------------------------------------------------------

@router.get("/merchants/{merchant_id}/shoppage", response_model=ShopPageResponse)
async def get_merchant_shoppage(merchant_id: int, db: Session = Depends(get_db)):
    shop_page = db.query(ShopPage).filter(ShopPage.merchant_id == merchant_id).first()
    if not shop_page:
        raise HTTPException(status_code=404, detail="Shop page not found")
    return shop_page


@router.post("/merchants/me/shoppage", response_model=ShopPageResponse)
async def create_my_shoppage(
    shop_page_in: ShopPageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    if merchant.shop_page:
        raise HTTPException(status_code=400, detail="Shop page already exists — use PATCH to update")

    existing_slug = db.query(ShopPage).filter(ShopPage.slug == shop_page_in.slug).first()
    if existing_slug:
        raise HTTPException(status_code=400, detail="Slug already taken")

    shop_page = ShopPage(merchant_id=merchant.id, **shop_page_in.model_dump(exclude={"merchant_id"}))
    db.add(shop_page)
    db.commit()
    db.refresh(shop_page)
    return shop_page


@router.patch("/merchants/me/shoppage", response_model=ShopPageResponse)
async def update_my_shoppage(
    shop_page_update: ShopPageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(status_code=404, detail="Shop page not found — create one first with POST")

    updates = shop_page_update.model_dump(exclude_unset=True)
    if "slug" in updates:
        existing = db.query(ShopPage).filter(ShopPage.slug == updates["slug"], ShopPage.id != shop_page.id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Slug already taken")

    for field, value in updates.items():
        setattr(shop_page, field, value)

    db.commit()
    db.refresh(shop_page)
    return shop_page

# ─────────────────────────────────────────────────────────────────────────────
# ADD THESE ROUTES TO backend/app/api/routes/router.py
# They provide native email/password auth for the mobile app.
# ─────────────────────────────────────────────────────────────────────────────

from passlib.context import CryptContext  # pip install passlib[bcrypt]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class MobileSignUpPayload(BaseModel):
    email: EmailStr
    password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class MobileSignInPayload(BaseModel):
    email: EmailStr
    password: str


@router.post("/auth/mobile/sign-up", response_model=AuthSyncResponse)
async def mobile_sign_up(
    payload: MobileSignUpPayload,
    db: Session = Depends(get_db),
) -> AuthSyncResponse:
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed = pwd_context.hash(payload.password)
    user = User(
        email=payload.email,
        first_name=payload.first_name,
        last_name=payload.last_name,
        # Store hash in external_auth_id field temporarily — in production
        # add a dedicated password_hash column to the User model.
        external_auth_id=f"mobile:{hashed}",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(subject=f"mobile_{user.id}", expires_minutes=60 * 24 * 7)
    return AuthSyncResponse(
        ok=True,
        user_id=user.id,
        email=user.email,
        access_token=access_token,
        expires_in=60 * 60 * 24 * 7,
    )


@router.post("/auth/mobile/sign-in", response_model=AuthSyncResponse)
async def mobile_sign_in(
    payload: MobileSignInPayload,
    db: Session = Depends(get_db),
) -> AuthSyncResponse:
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.external_auth_id or not user.external_auth_id.startswith("mobile:"):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    stored_hash = user.external_auth_id[len("mobile:"):]
    if not pwd_context.verify(payload.password, stored_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token = create_access_token(subject=f"mobile_{user.id}", expires_minutes=60 * 24 * 7)
    return AuthSyncResponse(
        ok=True,
        user_id=user.id,
        email=user.email,
        access_token=access_token,
        expires_in=60 * 60 * 24 * 7,
    )
