import logging
import os
from datetime import UTC, datetime
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.statuses import OrderStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.payment import CheckoutResponse, TransactionResponse
from app.services.order_reservations import (
    close_checkout_sessions,
    expire_stale_reservations,
    release_order_reservation,
    reservation_ttl_minutes,
    settle_checkout_payment,
)
from app.services.paymongo import (
    create_checkout_session,
    paid_payment_from_session,
    retrieve_checkout_session,
)
from app.services.sms_service import notify_merchant_new_order

router = APIRouter(prefix="/payments", tags=["payments"])

_raw_frontend = os.getenv("FRONTEND_URL", "http://localhost:3000")
FRONTEND_URL = _raw_frontend.split(",")[0].strip()
PLATFORM_FEE_RATE = 0.02

logger = logging.getLogger(__name__)


def _reconcile_transaction_from_paymongo(txn: Transaction, db: Session) -> None:
    """Recover a missed webhook while keeping the client-facing status current."""
    if txn.status != TransactionStatus.PENDING or not txn.paymongo_session_id:
        return

    try:
        session = retrieve_checkout_session(txn.paymongo_session_id)
    except requests.RequestException as exc:
        logger.warning(
            "Could not reconcile transaction %s with PayMongo: %s", txn.id, exc
        )
        return
    except RuntimeError as exc:
        logger.error("Payment configuration error during reconciliation: %s", exc)
        return

    paid, payment_id = paid_payment_from_session(session)
    if not paid:
        return

    outcome = settle_checkout_payment(txn, payment_id, db)
    if outcome == "duplicate":
        return
    db.commit()
    logger.info(
        "Reconciled transaction %s (%s), order %s", txn.id, outcome, txn.order_id
    )
    if outcome == "paid" and txn.order is not None:
        notify_merchant_new_order(order=txn.order)


def _validate_frontend_url(frontend_url: str) -> None:
    parsed = urlparse(frontend_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError("FRONTEND_URL is invalid or missing")


@router.post("/checkout/{order_id}", response_model=CheckoutResponse)
def create_payment_checkout(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    expire_stale_reservations(db, reservation_ttl_minutes())
    order = (
        db.query(Order)
        .join(OrderHistory, Order.order_history_id == OrderHistory.id)
        .filter(Order.id == order_id, OrderHistory.user_id == current_user.id)
        .with_for_update()
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # A retry after a missed webhook: settle a session that was already paid
    # instead of opening a second one the buyer could pay again.
    if order.status == OrderStatus.PENDING:
        open_txns = (
            db.query(Transaction)
            .filter(
                Transaction.order_id == order_id,
                Transaction.status == TransactionStatus.PENDING,
            )
            .all()
        )
        for open_txn in open_txns:
            _reconcile_transaction_from_paymongo(open_txn, db)
            if open_txn.status != TransactionStatus.PENDING:
                break
        db.refresh(order)

    if order.status != OrderStatus.PENDING:
        raise HTTPException(status_code=400, detail="This order is no longer awaiting payment")

    already_paid = (
        db.query(Transaction)
        .filter(Transaction.order_id == order_id, Transaction.status == TransactionStatus.PAID)
        .first()
    )
    if already_paid:
        raise HTTPException(status_code=400, detail="Order already paid")

    existing_pending = (
        db.query(Transaction)
        .filter(
            Transaction.order_id == order_id,
            Transaction.user_id == current_user.id,
            Transaction.status == TransactionStatus.PENDING,
        )
        .order_by(Transaction.created_at.desc())
        .first()
    )
    if (
        existing_pending
        and existing_pending.checkout_url
        and existing_pending.paymongo_session_id
        and existing_pending.created_at is not None
    ):
        created_at = existing_pending.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        if (datetime.now(UTC) - created_at).total_seconds() < reservation_ttl_minutes() * 60:
            return CheckoutResponse(
                transaction_id=existing_pending.id,
                order_id=order_id,
                checkout_url=existing_pending.checkout_url,
                paymongo_session_id=existing_pending.paymongo_session_id,
                amount=existing_pending.amount,
                status=existing_pending.status,
            )

    # Close any superseded session before opening a new one, so the buyer can't
    # pay for the same order twice.
    if not close_checkout_sessions(order, db):
        raise HTTPException(
            status_code=409, detail="A payment for this order is already in progress"
        )
    (
        db.query(Transaction)
        .filter(Transaction.order_id == order_id, Transaction.status == TransactionStatus.PENDING)
        .update({Transaction.status: TransactionStatus.EXPIRED}, synchronize_session=False)
    )

    merchant = db.query(Merchant).filter(Merchant.id == order.merchant_id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant not found")

    amount = order.total_price  # stored in pesos
    platform_fee = round(amount * PLATFORM_FEE_RATE)
    merchant_amount = amount - platform_fee

    _validate_frontend_url(FRONTEND_URL)

    try:
        session_data = create_checkout_session(
            amount_pesos=amount,
            description=f"Carabao Order #{order_id}",
            merchant_name=merchant.merchant_name,
            success_url=f"{FRONTEND_URL}/orders/success?order_id={order_id}",
            cancel_url=f"{FRONTEND_URL}/checkout?payment_cancelled=1&order_id={order_id}",
            reference_number=str(order_id),
        )
    except requests.HTTPError as e:
        release_order_reservation(order, db, transaction_status=TransactionStatus.FAILED)
        db.commit()
        response_text = ""
        if e.response is not None:
            response_text = e.response.text or ""
        logger.warning(
            "PayMongo HTTPError while creating checkout session: %s", response_text
        )
        raise HTTPException(
            status_code=502, detail=f"PayMongo error: {response_text[:2000]}"
        ) from e
    except RuntimeError as e:
        release_order_reservation(order, db, transaction_status=TransactionStatus.FAILED)
        db.commit()
        logger.error("Payment configuration error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        release_order_reservation(order, db, transaction_status=TransactionStatus.FAILED)
        db.commit()
        logger.exception("Unexpected error while creating checkout session")
        raise HTTPException(
            status_code=500, detail="Unexpected error creating checkout session"
        ) from e

    txn = Transaction(
        order_id=order_id,
        merchant_id=merchant.id,
        user_id=current_user.id,
        amount=amount,
        platform_fee=platform_fee,
        merchant_amount=merchant_amount,
        status=TransactionStatus.PENDING,
        description=f"Carabao Order #{order_id}",
        paymongo_session_id=session_data["id"],
        checkout_url=session_data["attributes"]["checkout_url"],
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)

    return CheckoutResponse(
        transaction_id=txn.id,
        order_id=order_id,
        checkout_url=txn.checkout_url,
        paymongo_session_id=txn.paymongo_session_id,
        amount=amount,
        status=txn.status,
    )


@router.post("/checkout/{order_id}/cancel", status_code=204)
def cancel_payment_checkout(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Release stock when PayMongo returns the buyer without a payment."""
    order = (
        db.query(Order)
        .join(OrderHistory, Order.order_history_id == OrderHistory.id)
        .filter(Order.id == order_id, OrderHistory.user_id == current_user.id)
        .with_for_update()
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    paid = (
        db.query(Transaction.id)
        .filter(Transaction.order_id == order.id, Transaction.status == TransactionStatus.PAID)
        .first()
    )
    if paid:
        raise HTTPException(status_code=409, detail="Order has already been paid")

    if order.status == OrderStatus.PENDING and not release_order_reservation(
        order, db, transaction_status=TransactionStatus.FAILED
    ):
        raise HTTPException(
            status_code=409, detail="A payment for this order is already in progress"
        )
    db.commit()


@router.get("/transactions/order/{order_id}", response_model=TransactionResponse)
def get_transaction_by_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    txn = (
        db.query(Transaction)
        .filter(
            Transaction.order_id == order_id, Transaction.user_id == current_user.id
        )
        .order_by(Transaction.created_at.desc())
        .first()
    )
    if not txn:
        raise HTTPException(
            status_code=404, detail="No transaction found for this order"
        )
    _reconcile_transaction_from_paymongo(txn, db)
    db.refresh(txn)
    return txn


@router.get("/transactions/{transaction_id}", response_model=TransactionResponse)
def get_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    txn = (
        db.query(Transaction)
        .filter(
            Transaction.id == transaction_id,
            Transaction.user_id == current_user.id,
        )
        .first()
    )
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return txn
