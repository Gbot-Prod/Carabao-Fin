"""Check a voucher code at checkout and work out its discount (CF-0058).

Everything is done on the server from stored rows: the buyer sends only the
code. One code per checkout; it applies to the order of the farm that owns it.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from decimal import ROUND_FLOOR, Decimal
from typing import Any, cast

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.order import Order
from app.models.statuses import OrderStatus
from app.models.voucher import Voucher, VoucherRedemption

CODE_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,31}$")

# Orders that do not use up a voucher: the buyer never paid for them, so the
# use is given back without a separate release step.
_RELEASED_STATUSES = (OrderStatus.CANCELLED, OrderStatus.PAYMENT_MISMATCH)

# One message for "no such code" and "code of a farm not in this cart", so a
# buyer cannot probe other farms' codes.
NOT_VALID = "This voucher code is not valid for the items in your cart."


def normalize_code(raw: str) -> str:
    """Upper case, no spaces around it. Raises 400 for a malformed code."""
    code = raw.strip().upper()
    if not CODE_PATTERN.fullmatch(code):
        raise HTTPException(status_code=400, detail=NOT_VALID)
    return code


def compute_discount(voucher: Voucher, subtotal: int) -> int:
    """Whole pesos off a produce subtotal. Never more than the subtotal."""
    value = int(cast(Any, voucher.value))
    if str(voucher.kind) == "percent":
        raw = (Decimal(subtotal) * Decimal(value) / Decimal(100)).to_integral_value(
            rounding=ROUND_FLOOR
        )
        discount = int(raw)
        cap = cast(Any, voucher.max_discount)
        if cap is not None:
            discount = min(discount, int(cap))
    else:
        discount = value
    return max(0, min(discount, subtotal))


def uses_count(db: Session, voucher_id: int, user_id: int | None = None) -> int:
    """Uses that count toward the caps (orders not cancelled)."""
    return _uses(db, voucher_id, user_id)


# CF-0061: rules over two or more fields, checked on the final values of a
# create or an edit. Single-field bounds are in schemas/voucher.py.
MAX_PERCENT = 90


def check_rules(values: dict[str, Any]) -> None:
    """Raise 422 when the combined voucher fields break a rule."""
    kind = values.get("kind")
    value = int(values.get("value") or 0)
    if kind == "percent" and not 1 <= value <= MAX_PERCENT:
        raise HTTPException(
            status_code=422, detail=f"A percent voucher is 1 to {MAX_PERCENT} %."
        )
    if kind == "fixed" and values.get("max_discount") is not None:
        raise HTTPException(
            status_code=422,
            detail="A maximum discount is only for percent vouchers.",
        )
    starts_at = _aware(values.get("starts_at"))
    expires_at = _aware(values.get("expires_at"))
    if starts_at is not None and expires_at is not None and expires_at <= starts_at:
        raise HTTPException(
            status_code=422, detail="The end date must be after the start date."
        )


def _uses(db: Session, voucher_id: int, user_id: int | None = None) -> int:
    query = (
        db.query(func.count(VoucherRedemption.id))
        .join(Order, Order.id == VoucherRedemption.order_id)
        .filter(
            VoucherRedemption.voucher_id == voucher_id,
            Order.status.notin_([s.value for s in _RELEASED_STATUSES]),
        )
    )
    if user_id is not None:
        query = query.filter(VoucherRedemption.user_id == user_id)
    return int(query.scalar() or 0)


def _aware(value: datetime | None) -> datetime | None:
    # SQLite gives naive datetimes back; they were stored as UTC.
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def claim(
    db: Session,
    raw_code: str,
    subtotal_by_merchant: dict[int, int],
    user_id: int,
    now: datetime | None = None,
) -> tuple[Voucher, int]:
    """The voucher for one of the cart's farms, locked, and its discount.

    Raises 400 with a buyer-facing reason when it cannot be used. The row lock
    makes two checkouts with the same code take turns, so usage caps hold.
    """
    code = normalize_code(raw_code)
    voucher = (
        db.query(Voucher)
        .filter(
            Voucher.code == code,
            Voucher.merchant_id.in_(list(subtotal_by_merchant)),
        )
        .with_for_update()
        .populate_existing()
        .first()
    )
    if voucher is None or not voucher.active:
        raise HTTPException(status_code=400, detail=NOT_VALID)

    now = now or datetime.now(UTC)
    starts_at = _aware(cast(Any, voucher.starts_at))
    expires_at = _aware(cast(Any, voucher.expires_at))
    if starts_at is not None and now < starts_at:
        raise HTTPException(status_code=400, detail="This voucher is not active yet.")
    if expires_at is not None and now >= expires_at:
        raise HTTPException(status_code=400, detail="This voucher has expired.")

    voucher_id = int(cast(Any, voucher.id))
    subtotal = subtotal_by_merchant[int(cast(Any, voucher.merchant_id))]
    min_subtotal = int(cast(Any, voucher.min_subtotal) or 0)
    if subtotal < min_subtotal:
        raise HTTPException(
            status_code=400,
            detail=(
                f"This voucher needs at least ₱{min_subtotal:,} of items from "
                f"the farm; your cart has ₱{subtotal:,}."
            ),
        )
    usage_limit = cast(Any, voucher.usage_limit)
    if usage_limit is not None and _uses(db, voucher_id) >= int(usage_limit):
        raise HTTPException(
            status_code=400, detail="This voucher has been fully used."
        )
    if _uses(db, voucher_id, user_id) >= int(cast(Any, voucher.per_user_limit)):
        raise HTTPException(
            status_code=400, detail="You have already used this voucher."
        )

    discount = compute_discount(voucher, subtotal)
    if discount <= 0:
        raise HTTPException(status_code=400, detail=NOT_VALID)
    return voucher, discount


def record(
    db: Session, voucher: Voucher, order: Order, user_id: int, discount: int
) -> None:
    """Store the use once the order has an id."""
    db.add(
        VoucherRedemption(
            voucher_id=voucher.id,
            user_id=user_id,
            order_id=order.id,
            discount=discount,
        )
    )
