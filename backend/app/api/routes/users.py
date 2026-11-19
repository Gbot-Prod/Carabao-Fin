import logging
from datetime import datetime

from fastapi import APIRouter, Body, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import exists, func
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.errors import upstream_error
from app.models.chat import ChatMessage, Conversation, ConversationRead
from app.models.merchant_application import MerchantApplication
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.payout_batch import PayoutBatch
from app.models.shipment import Shipment
from app.models.statuses import TransactionStatus
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
    data_export,
    r2_service,
    rate_limit,
    upload_validation,
)
from app.services.order_status import ACTIVE_ORDER_STATUSES
from app.services.produce_freshness import PH_TZ

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
    # Nested models dump only the keys sent (exclude_unset), so the stored
    # preferences hold exactly what the client chose (CF-0054).
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
    rate_limit.enforce_action(db, "image_upload", str(current_user.id))  # CF-0060
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
    """What stops the account being deleted now. Only non-zero counts.

    A buyer's closed, paid orders do not block (CF-0041): the payment records
    are kept without the person. Open orders and refunds still owed do, since
    the buyer must be reachable until they are settled. A merchant's sales,
    shipments and payouts still block: the cascade would delete the merchant row
    they point at.
    """
    active_orders = (
        db.query(func.count(Order.id))
        .filter(
            Order.user_id == user.id,
            Order.status.in_(ACTIVE_ORDER_STATUSES),
        )
        .scalar()
    )
    refunds_pending = (
        db.query(func.count(Transaction.id))
        .filter(
            Transaction.user_id == user.id,
            Transaction.status == TransactionStatus.REFUND_PENDING,
        )
        .scalar()
    )
    blockers = {"active_orders": active_orders, "refunds_pending": refunds_pending}

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


@router.get("/users/me/export")
def export_my_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JSONResponse:
    """CF-0069 (B18): the caller's own data as a JSON download."""
    rate_limit.enforce_action(db, "data_export", str(current_user.id))
    body = data_export.build_export(db, current_user)
    filename = f"carabao-my-data-{datetime.now(PH_TZ).strftime('%Y%m%d')}.json"
    return JSONResponse(
        body,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _refuse_if_blocked(db: Session, user: User) -> None:
    blockers = _account_deletion_blockers(db, user)
    if blockers:
        raise HTTPException(
            status_code=409,
            detail={
                "message": (
                    "Finish or cancel your open orders, and wait for any refund, "
                    "before you delete your account. A farm with sales must be "
                    "closed through support."
                ),
                "blockers": blockers,
            },
        )


def _identity_documents(db: Session, user: User) -> list[str]:
    """Every private ID document stored for this user (CF-0040)."""
    paths: set[str] = set()
    for rsbsa, gov_id in db.query(
        MerchantApplication.rsbsa_document_path,
        MerchantApplication.gov_id_document_path,
    ).filter(MerchantApplication.user_id == user.id):
        paths.update((rsbsa, gov_id))
    if user.merchant:
        paths.update(
            (user.merchant.rsbsa_document_path, user.merchant.gov_id_document_path)
        )
    return sorted(path for path in paths if path)


def _anonymize_kept_orders(db: Session, user: User) -> None:
    """Keep the buyer's paid orders as payment records, without the person.

    An order with a transaction stays (accounting); its delivery address, map
    pin, notes and chat go. Orders that never had a transaction are deleted.
    """
    has_txn = exists().where(Transaction.order_id == Order.id)
    kept_ids = [
        order_id
        for (order_id,) in db.query(Order.id).filter(
            Order.user_id == user.id, has_txn
        )
    ]
    if kept_ids:
        conversation_ids = db.query(Conversation.id).filter(
            Conversation.order_id.in_(kept_ids)
        )
        db.query(ChatMessage).filter(
            ChatMessage.conversation_id.in_(conversation_ids.scalar_subquery())
        ).delete(synchronize_session=False)
        db.query(ConversationRead).filter(
            ConversationRead.conversation_id.in_(conversation_ids.scalar_subquery())
        ).delete(synchronize_session=False)
        db.query(Conversation).filter(Conversation.order_id.in_(kept_ids)).delete(
            synchronize_session=False
        )
        db.query(Order).filter(Order.id.in_(kept_ids)).update(
            {
                Order.user_id: None,
                Order.delivery_address: None,
                Order.delivery_lat: None,
                Order.delivery_lng: None,
                Order.notes: None,
                Order.route_waypoints: None,
            },
            synchronize_session=False,
        )
    db.query(Transaction).filter(Transaction.user_id == user.id).update(
        {Transaction.user_id: None}, synchronize_session=False
    )
    # What is left never reached payment.
    db.query(Order).filter(Order.user_id == user.id).delete(
        synchronize_session=False
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

    # CF-0040: the ID scans go first. If R2 cannot delete them, nothing is
    # deleted, so no file is left with no row pointing at it.
    try:
        for path in _identity_documents(db, current_user):
            r2_service.delete_private_document(path)
    except Exception as exc:
        raise upstream_error(
            502,
            "Could not delete your documents. Try again later.",
            log="R2 delete of identity documents failed",
            exc=exc,
        ) from exc

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

    # CF-0041: paid orders stay as payment records without the buyer.
    _anonymize_kept_orders(db, current_user)

    # The backend row first (with the ORM cascades), then the login, or the next
    # sign-in would bring back an empty account. In this order the database
    # cascade from "user" finds nothing left to delete.
    identity_id = current_user.external_auth_id
    db.delete(current_user)
    db.flush()
    better_auth_store.delete_identity(db, identity_id)
    db.commit()
