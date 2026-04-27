import logging

import requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.current_orders import CurrentOrder
from app.models.mobile_credential import MobileCredential
from app.models.order import Order
from app.models.user import User
from app.schemas.payment import AttachPaymentMethodRequest, SavedCard
from app.schemas.user import UserResponse, UserUpdate
from app.services.paymongo import (
    attach_payment_method,
    detach_payment_method,
    get_or_create_paymongo_customer,
    list_customer_payment_methods,
)

router = APIRouter()
logger = logging.getLogger(__name__)


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


# ─── Payment methods ──────────────────────────────────────────────────────────

@router.get("/users/me/payment-methods", response_model=list[SavedCard])
async def list_my_payment_methods(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.paymongo_customer_id:
        return []
    try:
        raw = list_customer_payment_methods(current_user.paymongo_customer_id)
        return [SavedCard.from_paymongo(pm) for pm in raw]
    except requests.HTTPError as e:
        logger.warning("PayMongo list payment methods failed: %s", e)
        return []


@router.post("/users/me/payment-methods", response_model=SavedCard)
async def attach_my_payment_method(
    payload: AttachPaymentMethodRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        customer_id = get_or_create_paymongo_customer(db, current_user)
        pm = attach_payment_method(customer_id, payload.payment_method_id)
        return SavedCard.from_paymongo(pm)
    except requests.HTTPError as e:
        body = e.response.text if e.response is not None else ""
        logger.warning("PayMongo attach payment method failed: %s", body)
        raise HTTPException(status_code=502, detail=f"PayMongo error: {body[:400]}")


@router.delete("/users/me/payment-methods/{payment_method_id}", status_code=204)
async def detach_my_payment_method(
    payment_method_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.paymongo_customer_id:
        raise HTTPException(status_code=404, detail="No payment methods on file")
    try:
        detach_payment_method(current_user.paymongo_customer_id, payment_method_id)
    except requests.HTTPError as e:
        body = e.response.text if e.response is not None else ""
        raise HTTPException(status_code=502, detail=f"PayMongo error: {body[:400]}")


@router.delete("/users/me", status_code=204)
async def delete_my_account(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Orphan merchant references before cascade delete removes the merchant row.
    if current_user.merchant:
        merchant_id = current_user.merchant.id
        db.query(Order).filter(Order.merchant_id == merchant_id).update(
            {"merchant_id": None}, synchronize_session=False
        )
        db.query(CurrentOrder).filter(CurrentOrder.merchant_id == merchant_id).update(
            {"merchant_id": None}, synchronize_session=False
        )

    # MobileCredential has no cascade on the User side, delete it manually.
    db.query(MobileCredential).filter(
        MobileCredential.user_id == current_user.id
    ).delete(synchronize_session=False)

    db.delete(current_user)
    db.commit()
