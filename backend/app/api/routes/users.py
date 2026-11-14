import logging

import requests
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant_application import MerchantApplication
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.payout_batch import PayoutBatch
from app.models.shipment import Shipment
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.payment import AttachPaymentMethodRequest, SavedCard
from app.schemas.user import UserResponse, UserUpdate
from app.services import better_auth_store, r2_service
from app.services.order_status import ACTIVE_ORDER_STATUSES
from app.services.paymongo import (
    attach_payment_method,
    detach_payment_method,
    get_or_create_paymongo_customer,
    list_customer_payment_methods,
)

router = APIRouter(tags=["users"])
logger = logging.getLogger(__name__)


@router.get("/users/me", response_model=UserResponse)
def get_current_user_profile(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/users/me", response_model=UserResponse)
def update_current_user_profile(
    user_update: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updates = user_update.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(current_user, field, value)
    # Name and phone show in the BetterAuth session too; same transaction.
    better_auth_store.update_profile(db, current_user.external_auth_id, updates)

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/users/me/avatar", response_model=UserResponse)
def upload_my_avatar(
    avatar: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if avatar.content_type not in {
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
    }:
        raise HTTPException(status_code=400, detail="Avatar must be PNG, JPEG, or WebP")

    data = avatar.file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Avatar must be under 5 MB")
    try:
        url = r2_service.upload_avatar(
            current_user.id,
            data,
            avatar.content_type or "image/jpeg",
            avatar.filename or "",
        )
    except Exception as exc:
        logger.error("R2 avatar upload failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=502, detail=f"Image upload failed: {exc}"
        ) from exc

    current_user.profile_picture_url = url
    better_auth_store.update_profile(
        db, current_user.external_auth_id, {"profile_picture_url": url}
    )
    db.commit()
    db.refresh(current_user)
    return current_user


# ─── Payment methods ────────────────────────────────────────────────────

"""
@router.get("/users/me/payment-methods", response_model=list[SavedCard])
def list_my_payment_methods(
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
def attach_my_payment_method(
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
        raise HTTPException(
            status_code=502, detail=f"PayMongo error: {body[:400]}"
        ) from e


@router.delete("/users/me/payment-methods/{payment_method_id}", status_code=204)
def detach_my_payment_method(
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
        raise HTTPException(
            status_code=502, detail=f"PayMongo error: {body[:400]}"
        ) from e
"""

def _account_deletion_blockers(db: Session, user: User) -> dict[str, int]:
    """Dont delete 

    Transactions, shipments and payout batches hold non-nullable FKs to the
    user, their orders or their merchant row, so the delete cannot proceed
    while any exist. Returns only the non-zero counts.
    """
    active_orders = (
        db.query(func.count(Order.id))
        .filter(
            Order.user_id == user.id,
            Order.status.in_(ACTIVE_ORDER_STATUSES),
        )
        .scalar()
    )
    payment_records = (
        db.query(func.count(Transaction.id))
        .join(Order, Order.id == Transaction.order_id)
        .filter((Transaction.user_id == user.id) | (Order.user_id == user.id))
        .scalar()
    )
    blockers = {"active_orders": active_orders, "payment_records": payment_records}

    # Includes a soft-deleted merchant row: the cascade would still hard-delete it.
    if user.merchant:
        merchant_id = user.merchant.id
        blockers["merchant_payment_records"] = (
            db.query(func.count(Transaction.id))
            .filter(Transaction.merchant_id == merchant_id)
            .scalar()
        )
        blockers["shipments"] = (
            db.query(func.count(Shipment.id))
            .filter(Shipment.merchant_id == merchant_id)
            .scalar()
        )
        blockers["payout_batches"] = (
            db.query(func.count(PayoutBatch.id))
            .filter(PayoutBatch.merchant_id == merchant_id)
            .scalar()
        )

    return {key: int(value) for key, value in blockers.items() if value}


@router.delete("/users/me", status_code=204)
def delete_my_account(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Stopgap until accounts are anonymized instead of hard-deleted: refuse
    # rather than 500 on the FK violation or wipe financial records.
    blockers = _account_deletion_blockers(db, current_user)
    if blockers:
        raise HTTPException(
            status_code=409,
            detail={
                "message": (
                    "Accounts with order or payment history can't be deleted "
                    "yet. Contact support to close your account."
                ),
                "blockers": blockers,
            },
        )

    # MerchantApplication and MerchantPayoutInfo have no cascade on the User
    # or Merchant side, delete them manually.
    db.query(MerchantApplication).filter(
        MerchantApplication.user_id == current_user.id
    ).delete(synchronize_session=False)
    if current_user.merchant:
        db.query(MerchantPayoutInfo).filter(
            MerchantPayoutInfo.merchant_id == current_user.merchant.id
        ).delete(synchronize_session=False)

    # Orphan merchant references before cascade delete removes the merchant row.
    if current_user.merchant:
        merchant_id = current_user.merchant.id
        db.query(Order).filter(Order.merchant_id == merchant_id).update(
            {"merchant_id": None}, synchronize_session=False
        )

    # The buyer's own orders go with the account (formerly via the
    # order_histories cascade). The blockers above leave only closed, unpaid ones.
    db.query(Order).filter(Order.user_id == current_user.id).delete(
        synchronize_session=False
    )

    # The login goes too, or the next sign-in would bring back an empty account.
    better_auth_store.delete_identity(db, current_user.external_auth_id)
    db.delete(current_user)
    db.commit()
