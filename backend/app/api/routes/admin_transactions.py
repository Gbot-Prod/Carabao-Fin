"""Admin ledger of every transaction (checkout attempt), with CSV export."""

import csv
import io
from collections.abc import Iterator
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.routes.admin import _require_admin
from app.models.merchant import Merchant
from app.models.statuses import TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.admin_transaction import (
    AdminTransactionPage,
    AdminTransactionRow,
    AdminTransactionTotals,
)

router = APIRouter(tags=["admin"])

CSV_COLUMNS = [
    "transaction_id",
    "order_id",
    "status",
    "amount",
    "platform_fee",
    "merchant_amount",
    "created_at",
    "paid_at",
    "merchant_id",
    "merchant_name",
    "buyer_id",
    "buyer_name",
    "buyer_email",
    "paymongo_payment_id",
    "paymongo_session_id",
    "refund_method",
    "refund_reference",
    "refunded_at",
    "description",
]


class TransactionFilters:
    """Query params shared by the list and the CSV export."""

    def __init__(
        self,
        status: TransactionStatus | None = None,
        merchant_id: int | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        q: str | None = Query(None, max_length=200),
    ):
        self.status = status
        self.merchant_id = merchant_id
        self.date_from = date_from
        self.date_to = date_to
        self.q = (q or "").strip() or None


def _filtered(db: Session, f: TransactionFilters) -> SAQuery:
    q = (
        db.query(Transaction, User, Merchant)
        .outerjoin(User, User.id == Transaction.user_id)
        .outerjoin(Merchant, Merchant.id == Transaction.merchant_id)
    )
    if f.status is not None:
        q = q.filter(Transaction.status == f.status)
    if f.merchant_id is not None:
        q = q.filter(Transaction.merchant_id == f.merchant_id)
    # Dates filter on when the checkout attempt was created.
    if f.date_from is not None:
        q = q.filter(Transaction.created_at >= datetime.combine(f.date_from, time.min))
    if f.date_to is not None:
        end = datetime.combine(f.date_to + timedelta(days=1), time.min)
        q = q.filter(Transaction.created_at < end)
    if f.q is not None:
        like = f"%{f.q}%"
        clauses = [
            Transaction.paymongo_payment_id.ilike(like),
            Transaction.paymongo_session_id.ilike(like),
            Transaction.refund_reference.ilike(like),
            User.email.ilike(like),
        ]
        term = f.q.lstrip("#")
        if term.isdigit():
            clauses += [Transaction.id == int(term), Transaction.order_id == int(term)]
        q = q.filter(or_(*clauses))
    return q


def _buyer_name(user: User | None) -> str | None:
    return (user.name or None) if user is not None else None


def _row(txn: Transaction, user: User | None, merchant: Merchant | None) -> AdminTransactionRow:
    return AdminTransactionRow(
        id=txn.id,
        order_id=txn.order_id,
        status=txn.status,
        amount=txn.amount,
        platform_fee=txn.platform_fee,
        merchant_amount=txn.merchant_amount,
        description=txn.description,
        paymongo_session_id=txn.paymongo_session_id,
        paymongo_payment_id=txn.paymongo_payment_id,
        created_at=txn.created_at,
        paid_at=txn.paid_at,
        merchant_id=txn.merchant_id,
        merchant_name=merchant.merchant_name if merchant else None,
        buyer_id=txn.user_id,
        buyer_name=_buyer_name(user),
        buyer_email=user.email if user else None,
        refund_method=txn.refund_method,
        refund_reference=txn.refund_reference,
        refunded_at=txn.refunded_at,
    )


def _ordered(q: SAQuery) -> SAQuery:
    return q.order_by(Transaction.created_at.desc(), Transaction.id.desc())


@router.get("/admin/transactions", response_model=AdminTransactionPage)
def list_transactions(
    filters: TransactionFilters = Depends(),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    q = _filtered(db, filters)
    count, amount, fee, merchant_amount = q.with_entities(
        func.count(Transaction.id),
        func.coalesce(func.sum(Transaction.amount), 0),
        func.coalesce(func.sum(Transaction.platform_fee), 0),
        func.coalesce(func.sum(Transaction.merchant_amount), 0),
    ).one()
    rows = _ordered(q).offset((page - 1) * page_size).limit(page_size).all()
    return AdminTransactionPage(
        items=[_row(*r) for r in rows],
        total=count,
        page=page,
        page_size=page_size,
        totals=AdminTransactionTotals(
            count=count,
            amount=amount,
            platform_fee=fee,
            merchant_amount=merchant_amount,
        ),
    )


def _csv_cell(value) -> str:
    """Stringify a value, neutralising spreadsheet formula injection."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    text = str(value)
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


def _csv_lines(rows: list[AdminTransactionRow]) -> Iterator[str]:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_COLUMNS)
    for r in rows:
        writer.writerow(
            [
                _csv_cell(v)
                for v in (
                    r.id,
                    r.order_id,
                    r.status.value,
                    r.amount,
                    r.platform_fee,
                    r.merchant_amount,
                    r.created_at,
                    r.paid_at,
                    r.merchant_id,
                    r.merchant_name,
                    r.buyer_id,
                    r.buyer_name,
                    r.buyer_email,
                    r.paymongo_payment_id,
                    r.paymongo_session_id,
                    r.refund_method,
                    r.refund_reference,
                    r.refunded_at,
                    r.description,
                )
            ]
        )
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
    tail = buf.getvalue()
    if tail:
        yield tail


@router.get("/admin/transactions/export")
def export_transactions(
    filters: TransactionFilters = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    # Load everything before streaming: the request's DB session may close
    # before a lazily-consumed generator would finish reading from it.
    rows = [_row(*r) for r in _ordered(_filtered(db, filters)).all()]
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return StreamingResponse(
        _csv_lines(rows),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="transactions-{stamp}.csv"'
        },
    )
