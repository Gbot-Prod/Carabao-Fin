"""Sales charts for the merchant dashboard (F2).

Counts the same orders as ``/merchants/me/performance``: orders a payment has
landed on, cancelled ones left out of revenue. Days are Philippine calendar days.
"""

from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.order import Order
from app.models.produce import Produce
from app.models.statuses import OrderStatus
from app.models.user import User
from app.services.merchant_service import get_active_merchant
from app.services.order_status import money_received_clause
from app.services.produce_freshness import PH_TZ

router = APIRouter(tags=["merchants"])

ALLOWED_DAYS = (30, 90)


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


def _int(item: dict, *keys: str) -> int | None:
    for key in keys:
        try:
            return int(item[key])
        except (KeyError, TypeError, ValueError):
            continue
    return None


def merchant_sales(
    db: Session, merchant_id: int, days: int, now: datetime | None = None
) -> MerchantSales:
    today = (now or datetime.now(UTC)).astimezone(PH_TZ).date()
    first_day = today - timedelta(days=days - 1)
    since = datetime.combine(first_day, time.min, tzinfo=PH_TZ)

    orders = (
        db.query(Order)
        .filter(
            Order.merchant_id == merchant_id,
            money_received_clause(),
            Order.status != OrderStatus.CANCELLED,
            Order.ordered_at >= since,
        )
        .all()
    )

    buckets = {
        first_day + timedelta(days=i): {"revenue": 0, "orders": 0} for i in range(days)
    }
    products: dict[object, dict] = {}
    for order in orders:
        moment = order.ordered_at
        if moment.tzinfo is None:  # sqlite in tests
            moment = moment.replace(tzinfo=UTC)
        bucket = buckets.get(moment.astimezone(PH_TZ).date())
        if bucket is None:
            continue
        bucket["revenue"] += order.total_price or 0
        bucket["orders"] += 1
        for item in order.items or []:
            if not isinstance(item, dict):
                continue
            quantity = _int(item, "quantity") or 0
            if quantity <= 0:
                continue
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
            row["revenue"] += (_int(item, "price") or 0) * quantity

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
    )


@router.get("/merchants/me/sales", response_model=MerchantSales)
def get_my_sales(
    days: int = Query(30),
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
