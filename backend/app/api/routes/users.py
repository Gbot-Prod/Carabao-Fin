import logging

from fastapi import APIRouter, Body, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.errors import upstream_error
from app.models.merchant_application import MerchantApplication
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.payout_batch import PayoutBatch
from app.models.shipment import Shipment
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.user import (
    AccountDeleteCodeRequest,
    AccountDeleteCodeSent,
    AccountDeleteConfirm,
    UserResponse,
    UserUpdate,
)
from app.services import (
    account_deletion_otp,
    better_auth_store,
    r2_service,
    upload_validation,
)
from app.services.order_status import ACTIVE_ORDER_STATUSES

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
    # Name, email and phone are BetterAuth's; clients change them through its
    # client (updateUser, changeEmail, phoneNumber.verify).
    updates = user_update.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/users/me/avatar", response_model=UserResponse)
def upload_my_avatar(
    avatar: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    checked = upload_validation.check_image_upload(avatar, "Avatar")
    try:
        url = r2_service.upload_avatar(current_user.id, checked)
    except Exception as exc:
        raise upstream_error(
            502, "Image upload failed", log="R2 avatar upload failed", exc=exc
        ) from exc

    current_user.profile_picture_url = url
    better_auth_store.set_image(db, current_user.external_auth_id, url)
    db.commit()
    db.refresh(current_user)
    return current_user


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


def _refuse_if_blocked(db: Session, user: User) -> None:
    # Stopgap until accounts are anonymized instead of hard-deleted: refuse
    # rather than 500 on the FK violation or wipe financial records.
    blockers = _account_deletion_blockers(db, user)
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


@router.post("/users/me/delete-code", response_model=AccountDeleteCodeSent)
def send_account_delete_code(
    request: Request,
    payload: AccountDeleteCodeRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Text the code that confirms deleting the account, after the account's
    password (when it has one). Refuses (409) first when the account can't be
    deleted, so no SMS is spent on it."""
    _refuse_if_blocked(db, current_user)
    account_deletion_otp.check_password(
        db, request, current_user, payload.password if payload else None
    )
    sent_to = account_deletion_otp.send_code(db, request, current_user)
    return AccountDeleteCodeSent(sent_to=sent_to)


@router.delete("/users/me", status_code=204)
def delete_my_account(
    request: Request,
    payload: AccountDeleteConfirm = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete the account, confirmed with the code from /users/me/delete-code."""
    _refuse_if_blocked(db, current_user)
    account_deletion_otp.check_code(db, request, current_user, payload.code)

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

    # The backend row first (with the ORM cascades), then the login, or the next
    # sign-in would bring back an empty account. In this order the database
    # cascade from "user" finds nothing left to delete.
    identity_id = current_user.external_auth_id
    db.delete(current_user)
    db.flush()
    better_auth_store.delete_identity(db, identity_id)
    db.commit()
