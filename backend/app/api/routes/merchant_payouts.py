"""A farm's payout details, transactions and payout requests (CF-0079: moved
from routes/merchants.py; merged with main's CF-0046 transfer limit and CF-0054
edit lock)."""

import logging
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.errors import upstream_error
from app.models.merchant_payout import (
    MerchantPayoutInfo,
    PayoutDestinationChange,
    PayoutVerificationAttempt,
)
from app.models.order import Order
from app.models.payout_batch import PayoutBatch, PayoutBatchItem
from app.models.statuses import (
    OPEN_PAYOUT_STATUSES,
    PayoutDestinationVerificationStatus,
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
    PennyDropConfirmRequest,
    PennyDropStartedResponse,
    ReceivingInstitution,
    TransactionSummary,
)
from app.services import (
    notifications,
    paymongo,
    payout_otp,
    payout_verification,
    rate_limit,
)
from app.services.merchant_service import (
    get_active_merchant,
    get_editable_merchant,
)
from app.services.merchant_verification import (
    PAYOUT_NOT_VERIFIED_DETAIL,
    merchant_can_request_payout,
)
from app.services.payout_service import (
    MIN_TRANSFER_PESOS,
    PROVIDER_LABELS,
    PROVIDER_MAX_PESOS,
    PayoutError,
    claimable_transactions,
    fit_to_transfer_limit,
    get_payout_info,
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
) -> MerchantPayoutInfo | None:
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return get_payout_info(db, merchant.id)


@router.get(
    "/merchants/me/payout-institutions", response_model=list[ReceivingInstitution]
)
def list_payout_institutions(
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
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


def _payout_values(payload: PayoutInfoUpdate) -> dict[str, Any]:
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


def _payout_snapshot(info: MerchantPayoutInfo | None) -> dict[str, Any] | None:
    if info is None:
        return None
    return _payout_fields(info)


def _payout_fields(info: MerchantPayoutInfo) -> dict[str, Any]:
    return {field: getattr(info, field) for field in _PAYOUT_FIELDS}


@router.post("/merchants/me/payout-info/code", response_model=PayoutCodeSent)
def send_payout_info_code(
    payload: PayoutInfoUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PayoutCodeSent:
    """CF-0004: text a code that confirms exactly this payout method."""
    merchant = get_editable_merchant(db, current_user.id)
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
) -> MerchantPayoutInfo:
    """Save a payout method confirmed with its SMS code (CF-0004).

    Writes an audit row, moves failed payouts to the new method (requested
    ones keep theirs) and alerts the merchant's contacts on file.
    """
    # CF-0024: the PayMongo call and the code check (which commits) come
    # first. The row lock is then held only for the write, until one commit.
    if not get_editable_merchant(db, current_user.id):
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    values = _payout_values(payload)
    payout_otp.check_code(db, request, current_user, values, payload.code)
    merchant = get_editable_merchant(db, current_user.id, for_update=True)
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
    payout_verification.reset_verification(db, info)

    db.add(
        PayoutDestinationChange(
            merchant_id=merchant.id,
            user_id=current_user.id,
            before=before,
            after=_payout_fields(info),
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


@router.post("/merchants/me/payout-info/verify", response_model=PennyDropStartedResponse)
def start_payout_verification(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PennyDropStartedResponse:
    """Send a ₱10.01–₱10.99 penny-drop transfer to verify the saved destination."""
    merchant = get_editable_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    try:
        attempt = payout_verification.start_penny_drop(db, merchant.id)
    except PayoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    month_ago = datetime.now(UTC) - timedelta(days=30)
    used = (
        db.query(PayoutVerificationAttempt)
        .filter(
            PayoutVerificationAttempt.merchant_id == merchant.id,
            PayoutVerificationAttempt.created_at >= month_ago,
        )
        .count()
    )
    return PennyDropStartedResponse(
        status=attempt.status,
        expires_at=attempt.expires_at,
        attempts_remaining=attempt.attempts_remaining,
        monthly_attempts_used=used,
        monthly_attempts_limit=payout_verification.PENNY_DROP_MAX_MONTHLY_ATTEMPTS,
    )


@router.post("/merchants/me/payout-info/verify/confirm", response_model=PayoutInfoResponse)
def confirm_payout_verification(
    payload: PennyDropConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MerchantPayoutInfo:
    """Confirm the exact centavos received from the penny-drop transfer."""
    merchant = get_editable_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    try:
        return payout_verification.confirm_penny_drop(
            db, merchant.id, payload.centavos()
        )
    except PayoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/merchants/me/payouts", response_model=list[PayoutBatchResponse])
def get_my_payouts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PayoutBatch]:
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
) -> list[TransactionSummary]:
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    rows: Sequence[tuple[Transaction, Any]] = (
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
) -> AvailablePayout:
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
) -> PayoutBatch:
    # The row lock makes a concurrent request wait, then see this one as pending.
    merchant = get_active_merchant(db, current_user.id, for_update=True)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    # Payout details may be set up before verification; payouts may not. A
    # suspended merchant is still paid what it earned (CF-0054).
    if not merchant_can_request_payout(merchant):
        raise HTTPException(status_code=403, detail=PAYOUT_NOT_VERIFIED_DETAIL)

    info = get_payout_info(db, merchant.id)
    problem = payout_info_problem(info)
    if problem or info is None:
        raise HTTPException(status_code=400, detail=problem or "Set up your payout method first.")
    if info.verification_status != PayoutDestinationVerificationStatus.VERIFIED:
        raise HTTPException(
            status_code=403,
            detail="Verify your payout destination with the micro-deposit before requesting a payout.",
        )

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

    fee = transfer_fee()
    destination = resolve_destination(info)
    # CF-0046: never more than one transfer can carry; the rest waits.
    unpaid_txns = fit_to_transfer_limit(unpaid_txns, destination.provider, fee)
    if not unpaid_txns:
        provider = destination.provider
        raise HTTPException(
            status_code=400,
            detail=(
                f"An order's earnings are above the {PROVIDER_LABELS[provider]} "
                f"limit of ₱{PROVIDER_MAX_PESOS[provider]:,} per transfer. "
                "Contact support to cash it out."
            ),
        )

    total = sum(t.merchant_amount for t in unpaid_txns)
    if total - fee < MIN_TRANSFER_PESOS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Earnings of ₱{total} less the ₱{fee} transfer fee are below "
                f"the ₱{MIN_TRANSFER_PESOS} minimum payout"
            ),
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
    save_destination(batch, destination)
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
