import os
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.security import create_access_token
from app.models.cart import Cart
from app.models.merchant import Merchant
from app.models.user import User
from app.schemas.cart import CartResponse, CartUpdate
from app.schemas.merchant import MerchantBase, MerchantPageBase, MerchantResponse, MerchantUpdate
from app.schemas.user import UserResponse, UserUpdate
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