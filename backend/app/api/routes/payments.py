import os
from datetime import date, datetime, timedelta, timezone

import requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.payout_batch import PayoutBatch, PayoutBatchItem
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.payment import (
    CheckoutResponse,
    MerchantPayoutInfoCreate,
    MerchantPayoutInfoResponse,
    PayoutBatchResponse,
    TransactionResponse,
)
from app.services.paymongo import create_checkout_session

router = APIRouter(prefix="/payments", tags=["payments"])

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
PLATFORM_FEE_RATE = 0.01


@router.post("/checkout/{order_id}", response_model=CheckoutResponse)
def create_payment_checkout(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = (
        db.query(Order)
        .join(OrderHistory, Order.order_history_id == OrderHistory.id)
        .filter(Order.id == order_id, OrderHistory.user_id == current_user.id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    already_paid = (
        db.query(Transaction)
        .filter(Transaction.order_id == order_id, Transaction.status == "paid")
        .first()
    )
    if already_paid:
        raise HTTPException(status_code=400, detail="Order already paid")

    existing_pending = (
        db.query(Transaction)
        .filter(
            Transaction.order_id == order_id,
            Transaction.user_id == current_user.id,
            Transaction.status == "pending",
        )
        .order_by(Transaction.created_at.desc())
        .first()
    )
    if (
        existing_pending
        and existing_pending.checkout_url
        and existing_pending.paymongo_session_id
    ):
        return CheckoutResponse(
            transaction_id=existing_pending.id,
            order_id=order_id,
            checkout_url=existing_pending.checkout_url,
            paymongo_session_id=existing_pending.paymongo_session_id,
            amount=existing_pending.amount,
            status=existing_pending.status,
        )

    merchant = db.query(Merchant).filter(Merchant.id == order.merchant_id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant not found")

    amount = order.total_price  # stored in pesos
    platform_fee = round(amount * PLATFORM_FEE_RATE)
    merchant_amount = amount - platform_fee

    try:
        session_data = create_checkout_session(
            amount_pesos=amount,
            description=f"Carabao Order #{order_id}",
            merchant_name=merchant.merchant_name,
            success_url=f"{FRONTEND_URL}/orders/success?order_id={order_id}",
            cancel_url=f"{FRONTEND_URL}/checkout",
            reference_number=str(order_id),
        )
    except requests.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"PayMongo error: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    txn = Transaction(
        order_id=order_id,
        merchant_id=merchant.id,
        user_id=current_user.id,
        amount=amount,
        platform_fee=platform_fee,
        merchant_amount=merchant_amount,
        status="pending",
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


@router.get("/transactions/order/{order_id}", response_model=TransactionResponse)
def get_transaction_by_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    txn = (
        db.query(Transaction)
        .filter(Transaction.order_id == order_id, Transaction.user_id == current_user.id)
        .order_by(Transaction.created_at.desc())
        .first()
    )
    if not txn:
        raise HTTPException(status_code=404, detail="No transaction found for this order")
    return txn


@router.get("/transactions/{transaction_id}", response_model=TransactionResponse)
def get_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    txn = db.query(Transaction).filter(
        Transaction.id == transaction_id,
        Transaction.user_id == current_user.id,
    ).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return txn


# ---------------------------------------------------------------------------
# Merchant payout info
# ---------------------------------------------------------------------------

@router.post("/merchant/payout-info", response_model=MerchantPayoutInfoResponse)
def upsert_merchant_payout_info(
    payload: MerchantPayoutInfoCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=403, detail="Not a merchant account")

    info = db.query(MerchantPayoutInfo).filter(
        MerchantPayoutInfo.merchant_id == merchant.id
    ).first()

    if info:
        for k, v in payload.model_dump(exclude_unset=True).items():
            setattr(info, k, v)
    else:
        info = MerchantPayoutInfo(merchant_id=merchant.id, **payload.model_dump())
        db.add(info)

    db.commit()
    db.refresh(info)
    return info


@router.get("/merchant/payout-info", response_model=MerchantPayoutInfoResponse)
def get_merchant_payout_info(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=403, detail="Not a merchant account")

    info = db.query(MerchantPayoutInfo).filter(
        MerchantPayoutInfo.merchant_id == merchant.id
    ).first()
    if not info:
        raise HTTPException(status_code=404, detail="No payout info configured")
    return info


# ---------------------------------------------------------------------------
# Admin: payout batch management
# ---------------------------------------------------------------------------

def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    return current_user


@router.post("/admin/batches/generate", response_model=list[PayoutBatchResponse])
def generate_payout_batches(
    period: date | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Groups all paid, unbatched transactions for the given date (defaults to today) into per-merchant batches."""
    target_date = period or date.today()
    start_dt = datetime(target_date.year, target_date.month, target_date.day, tzinfo=timezone.utc)
    end_dt = start_dt + timedelta(days=1)

    unbatched = (
        db.query(Transaction)
        .outerjoin(PayoutBatchItem, PayoutBatchItem.transaction_id == Transaction.id)
        .filter(
            Transaction.status == "paid",
            Transaction.paid_at >= start_dt,
            Transaction.paid_at < end_dt,
            PayoutBatchItem.id.is_(None),
        )
        .all()
    )

    if not unbatched:
        return []

    # Group by merchant
    by_merchant: dict[int, list[Transaction]] = {}
    for txn in unbatched:
        by_merchant.setdefault(txn.merchant_id, []).append(txn)

    batches = []
    for merchant_id, txns in by_merchant.items():
        batch = PayoutBatch(
            merchant_id=merchant_id,
            period_date=target_date,
            transaction_count=len(txns),
            gross_amount=sum(t.merchant_amount for t in txns),
            status="pending",
        )
        db.add(batch)
        db.flush()

        for txn in txns:
            db.add(PayoutBatchItem(
                batch_id=batch.id,
                transaction_id=txn.id,
                amount=txn.merchant_amount,
            ))

        batches.append(batch)

    db.commit()
    for b in batches:
        db.refresh(b)
    return batches


@router.get("/admin/batches", response_model=list[PayoutBatchResponse])
def list_payout_batches(
    status: str | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    q = db.query(PayoutBatch)
    if status:
        q = q.filter(PayoutBatch.status == status)
    return q.order_by(PayoutBatch.period_date.desc()).all()


@router.patch("/admin/batches/{batch_id}/release", response_model=PayoutBatchResponse)
def release_payout_batch(
    batch_id: int,
    notes: str | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    batch = db.query(PayoutBatch).filter(PayoutBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.status == "released":
        raise HTTPException(status_code=400, detail="Batch already released")

    batch.status = "released"
    batch.released_at = datetime.now(timezone.utc)
    if notes:
        batch.notes = notes

    db.commit()
    db.refresh(batch)
    return batch
