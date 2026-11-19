"""A farm's payout details, transactions and payout requests (CF-0079: moved
from routes/merchants.py without a change in behaviour)."""

import logging
from datetime import UTC, datetime

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.errors import upstream_error
from app.models.merchant_payout import MerchantPayoutInfo, PayoutDestinationChange
from app.models.order import Order
from app.models.payout_batch import PayoutBatch, PayoutBatchItem
from app.models.statuses import (
    OPEN_PAYOUT_STATUSES,
    PayoutStatus,
)
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.payout import (
    AvailablePayout,
    PayoutBatchResponse,
    PayoutCodeSent,
    PayoutInfoChange,
    PayoutInfoResponse,
    PayoutInfoUpdate,
    ReceivingInstitution,
    TransactionSummary,
)
from app.services import (
    notifications,
    paymongo,
    payout_otp,
    rate_limit,
)
from app.services.merchant_service import (
    get_active_merchant,
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

logger = logging.getLogger(__name__)

router = APIRouter(tags=["merchants"])


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
