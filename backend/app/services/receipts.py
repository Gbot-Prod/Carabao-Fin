"""Build a buyer's receipt from an order and its payment (CF-0049, B09).

The receipt is a read-only view: every amount comes from the order snapshot
taken at checkout (``orders.items``, ``delivery_fee``, ``total_price``), not
from today's listing, so it never changes after payment.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.order import Order
from app.models.transaction import Transaction
from app.schemas.receipt import ReceiptLine, ReceiptResponse
from app.services.notifications import order_ref
from app.services.order_status import MONEY_RECEIVED_STATUSES


def receipt_payment(db: Session, order: Order) -> Transaction | None:
    """The order's payment the receipt is for: the newest one money landed on."""
    return (
        db.query(Transaction)
        .filter(
            Transaction.order_id == order.id,
            Transaction.status.in_(MONEY_RECEIVED_STATUSES),
        )
        .order_by(Transaction.paid_at.desc(), Transaction.id.desc())
        .first()
    )


def _int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def receipt_lines(items: Any) -> list[ReceiptLine]:
    """Order lines as receipt rows. Older orders store ``name``, newer ``produce``."""
    lines: list[ReceiptLine] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        quantity = _int(item.get("quantity"))
        price = _int(item.get("price"))
        lines.append(
            ReceiptLine(
                name=str(item.get("produce") or item.get("name") or "Item"),
                unit=item.get("unit") or None,
                quantity=quantity,
                unit_price=price,
                line_total=quantity * price,
            )
        )
    return lines


def build_receipt(order: Order, payment: Transaction) -> ReceiptResponse:
    delivery_fee = _int(order.delivery_fee)
    total = _int(order.total_price)
    merchant = order.merchant
    buyer = order.user
    town = ""
    if merchant is not None:
        town = ", ".join(str(p) for p in (merchant.city, merchant.province) if p)
    data: dict[str, Any] = {
        "receipt_number": order_ref(order),
        "order_id": order.id,
        "order_status": str(order.status),
        "ordered_at": order.ordered_at,
        "paid_at": payment.paid_at,
        "payment_status": str(payment.status),
        "payment_reference": payment.paymongo_payment_id,
        "buyer_name": buyer.name if buyer is not None else None,
        "farm_name": merchant.merchant_name if merchant is not None else None,
        "farm_town": town or None,
        "farm_contact_number": merchant.contact_number if merchant else None,
        "delivery_address": order.delivery_address,
        "requested_delivery_date": order.requested_delivery_date,
        "delivery_window": order.delivery_window,
        "lines": receipt_lines(order.items),
        # The total charged is the stored order total; the subtotal is what is
        # left after the delivery fee, so the three always add up.
        "subtotal": total - delivery_fee,
        "delivery_fee": delivery_fee,
        "total": total,
    }
    return ReceiptResponse(**data)
