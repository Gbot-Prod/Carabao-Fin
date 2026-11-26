"""Sales charts for the merchant dashboard (F2).

Counts the same orders as ``/merchants/me/performance``: orders a payment has
landed on, cancelled ones left out of revenue. Days are Philippine calendar days.
"""

import logging
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.csv_export import csv_lines
from app.models.order import Order
from app.models.produce import Produce
from app.models.statuses import OrderStatus
from app.models.user import User
from app.services import money
from app.services.merchant_service import get_active_merchant
from app.services.notifications import order_ref
from app.services.order_status import money_received_clause
from app.services.produce_freshness import PH_TZ

router = APIRouter(tags=["merchants"])
logger = logging.getLogger(__name__)

ALLOWED_DAYS = (30, 90)
# CF-0094 (B102): a schema bound too; the handlers still allow only ALLOWED_DAYS.
MAX_DAYS = max(ALLOWED_DAYS)
# The dashboard tabs (7 / 30 / 90 days) can all be exported (CF-0055).
EXPORT_DAYS = (7, 30, 90)
EXPORT_COLUMNS = [
    "order_ref",
    "order_id",
    "ordered_at_manila",
    "order_status",
    "produce_id",
    "produce",
    "unit",
    "quantity",
    "unit_price",
    "line_total",
    "order_delivery_fee",
    "order_total",
]


class SalesDay(BaseModel):
    date: date
    revenue: int
    orders: int


class TopProduct(BaseModel):
    produce_id: int | None
    name: str
    quantity: int
    revenue: int


class MerchantSales(BaseModel):
    days: int
    total_revenue: int
    total_orders: int
    daily: list[SalesDay]
    top_products: list[TopProduct]
    # Orders left out because an item price was bad (CF-0027).
    skipped_rows: int = 0


def _int(item: dict, *keys: str) -> int | None:
    for key in keys:
        try:
            return int(item[key])
        except (KeyError, TypeError, ValueError):
            continue
    return None


def _window(days: int, now: datetime | None) -> tuple[date, datetime]:
    today = (now or datetime.now(UTC)).astimezone(PH_TZ).date()
    first_day = today - timedelta(days=days - 1)
    return first_day, datetime.combine(first_day, time.min, tzinfo=PH_TZ)


def _sales_orders(db: Session, merchant_id: int, since: datetime) -> list[Order]:
    """The orders the charts count: money received, not cancelled (one place,
    so the export and the dashboard always agree)."""
    return (
        db.query(Order)
        .filter(
            Order.merchant_id == merchant_id,
            money_received_clause(),
            Order.status != OrderStatus.CANCELLED,
            Order.ordered_at >= since,
        )
        .order_by(Order.ordered_at.asc(), Order.id.asc())
        .all()
    )


def merchant_sales(
    db: Session, merchant_id: int, days: int, now: datetime | None = None
) -> MerchantSales:
    first_day, since = _window(days, now)
    orders = _sales_orders(db, merchant_id, since)

    buckets = {
        first_day + timedelta(days=i): {"revenue": 0, "orders": 0} for i in range(days)
    }
    products: dict[object, dict] = {}
    skipped_rows = 0
    for order in orders:
        moment = order.ordered_at
        if moment.tzinfo is None:  # sqlite in tests
            moment = moment.replace(tzinfo=UTC)
        bucket = buckets.get(moment.astimezone(PH_TZ).date())
        if bucket is None:
            continue
        # Read all lines first: a bad snapshot price is never counted as 0
        # (CF-0014). The order is logged and skipped as a whole, so the totals
        # stay consistent and one bad row does not cause a 500 (CF-0027).
        lines = []
        try:
            for item in order.items or []:
                if not isinstance(item, dict):
                    continue
                quantity = _int(item, "quantity") or 0
                if quantity <= 0:
                    continue
                lines.append(
                    (item, quantity, money.line_total(item.get("price"), quantity))
                )
        except money.InvalidAmount as exc:
            logger.warning(
                "Merchant sales: skipped order %s with a bad item price: %s",
                order.id,
                exc,
            )
            skipped_rows += 1
            continue

        bucket["revenue"] += order.total_price or 0
        bucket["orders"] += 1
        for item, quantity, line_total in lines:
            pid = _int(item, "produce_id", "produceId")
            key = pid if pid is not None else f"name:{item.get('name')}"
            row = products.setdefault(
                key,
                {
                    "produce_id": pid,
                    "name": item.get("name"),
                    "quantity": 0,
                    "revenue": 0,
                },
            )
            row["quantity"] += quantity
            row["revenue"] += line_total

    # Fill names from the listing when the order snapshot has none.
    missing = [
        r["produce_id"] for r in products.values() if not r["name"] and r["produce_id"]
    ]
    names = (
        dict(db.query(Produce.id, Produce.name).filter(Produce.id.in_(missing)).all())
        if missing
        else {}
    )
    top = sorted(
        (
            TopProduct(
                produce_id=r["produce_id"],
                name=r["name"] or names.get(r["produce_id"]) or "Removed listing",
                quantity=r["quantity"],
                revenue=r["revenue"],
            )
            for r in products.values()
        ),
        key=lambda p: (-p.revenue, -p.quantity, p.name),
    )[:5]

    daily = [SalesDay(date=d, **v) for d, v in buckets.items()]
    return MerchantSales(
        days=days,
        total_revenue=sum(d.revenue for d in daily),
        total_orders=sum(d.orders for d in daily),
        daily=daily,
        top_products=top,
        skipped_rows=skipped_rows,
    )


@router.get("/merchants/me/sales", response_model=MerchantSales)
def get_my_sales(
    days: int = Query(30, ge=1, le=MAX_DAYS),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revenue and orders per day plus the top 5 products, last 30 or 90 days."""
    if days not in ALLOWED_DAYS:
        raise HTTPException(status_code=422, detail="days must be 30 or 90")
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return merchant_sales(db, merchant.id, days)


def _manila(moment: datetime) -> datetime:
    if moment.tzinfo is None:  # sqlite in tests
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(PH_TZ)


def sales_export_rows(
    db: Session, merchant_id: int, days: int, now: datetime | None = None
) -> list[list[object]]:
    """CF-0055 (B12): one row per order line, same orders as the charts.

    No buyer name, phone or address: the file is for the merchant's books and
    may be shared. An order with a bad line price is left out whole, as in the
    charts (CF-0027).
    """
    _, since = _window(days, now)
    rows: list[list[object]] = []
    for order in _sales_orders(db, merchant_id, since):
        lines: list[list[object]] = []
        try:
            items: list[Any] = getattr(order, "items", None) or []
            for item in items:
                if not isinstance(item, dict):
                    continue
                quantity = _int(item, "quantity") or 0
                if quantity <= 0:
                    continue
                unit_price = money.whole_pesos(item.get("price"))
                lines.append(
                    [
                        _int(item, "produce_id", "produceId"),
                        item.get("produce") or item.get("name") or "",
                        item.get("unit") or "",
                        quantity,
                        unit_price,
                        money.line_total(unit_price, quantity),
                    ]
                )
        except money.InvalidAmount:
            logger.warning("Sales export: skipped order %s (bad item price)", order.id)
            continue
        head: list[object] = [
            order_ref(order),
            order.id,
            _manila(cast(datetime, order.ordered_at)).isoformat(timespec="minutes"),
            str(order.status),
        ]
        tail: list[object] = [
            order.delivery_fee or 0,
            order.total_price or 0,
        ]
        rows.extend(head + line + tail for line in lines)
    return rows


@router.get("/merchants/me/sales/export")
def export_my_sales(
    days: int = Query(30, ge=1, le=MAX_DAYS),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """CSV of the merchant's sales lines for the last 7, 30 or 90 days."""
    if days not in EXPORT_DAYS:
        raise HTTPException(status_code=422, detail="days must be 7, 30 or 90")
    merchant = get_active_merchant(db, cast(int, current_user.id))
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    # Built before streaming: the request's session may close first.
    rows = sales_export_rows(db, cast(int, merchant.id), days)
    stamp = datetime.now(UTC).astimezone(PH_TZ).strftime("%Y%m%d")
    return StreamingResponse(
        csv_lines(EXPORT_COLUMNS, rows),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="sales-{days}d-{stamp}.csv"'
            )
        },
    )
