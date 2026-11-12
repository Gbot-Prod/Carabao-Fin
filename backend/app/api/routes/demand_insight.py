"""Demand insight for merchants (F3): what is ordered and searched near them.

"In your province" means:
- ordered: paid, non-cancelled orders from farms in the merchant's province
  (orders don't store a delivery province; farms deliver locally);
- searched: buyer searches filtered to that province (U2 search log).
Luzon-wide searches are returned too, since most searches have no province.
Only product names and counts are shown, never other farms or buyers.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.produce import Produce
from app.models.search_log import SearchLog
from app.models.statuses import OrderStatus
from app.models.user import User
from app.services.merchant_service import get_active_merchant
from app.services.order_status import money_received_clause

router = APIRouter(tags=["merchants"])

WINDOW_DAYS = 30
LIMIT = 10


class OrderedProduce(BaseModel):
    name: str
    orders: int
    quantity: int


class SearchedTerm(BaseModel):
    query: str
    searches: int
    no_result_searches: int


class DemandInsight(BaseModel):
    province: str
    days: int = WINDOW_DAYS
    most_ordered: list[OrderedProduce]
    most_searched: list[SearchedTerm]
    most_searched_luzon: list[SearchedTerm]


def _int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _most_ordered(db: Session, province: str, since: datetime) -> list[OrderedProduce]:
    orders = (
        db.query(Order.items)
        .join(Merchant, Merchant.id == Order.merchant_id)
        .filter(
            func.lower(Merchant.province) == province.lower(),
            money_received_clause(),
            Order.status != OrderStatus.CANCELLED,
            Order.ordered_at >= since,
        )
        .all()
    )
    lines: list[tuple[int | None, str | None, int]] = []
    for (items,) in orders:
        for item in items or []:
            if not isinstance(item, dict) or _int(item.get("quantity")) <= 0:
                continue
            pid = item.get("produce_id") or item.get("produceId")
            lines.append((_int(pid) or None, item.get("name"), _int(item["quantity"])))

    missing = {pid for pid, name, _ in lines if pid and not name}
    names = (
        dict(db.query(Produce.id, Produce.name).filter(Produce.id.in_(missing)).all())
        if missing
        else {}
    )
    totals: dict[str, dict] = {}
    for pid, name, qty in lines:
        label = (name or names.get(pid) or "").strip()
        if not label:
            continue
        row = totals.setdefault(
            label.lower(), {"name": label, "orders": 0, "quantity": 0}
        )
        row["orders"] += 1  # order lines; one product appears once per order
        row["quantity"] += qty
    ranked = sorted(
        totals.values(), key=lambda r: (-r["orders"], -r["quantity"], r["name"])
    )
    return [OrderedProduce(**r) for r in ranked[:LIMIT]]


def _most_searched(
    db: Session, since: datetime, province: str | None
) -> list[SearchedTerm]:
    q = db.query(
        SearchLog.query,
        func.count(SearchLog.id),
        func.sum(case((SearchLog.result_count == 0, 1), else_=0)),
    ).filter(SearchLog.created_at >= since, SearchLog.query != "")
    if province is not None:
        q = q.filter(func.lower(SearchLog.province) == province.lower())
    rows = (
        q.group_by(SearchLog.query)
        .order_by(func.count(SearchLog.id).desc(), SearchLog.query)
        .limit(LIMIT)
        .all()
    )
    return [
        SearchedTerm(query=term, searches=int(n), no_result_searches=int(empty or 0))
        for term, n, empty in rows
    ]


def demand_insight(
    db: Session, province: str, now: datetime | None = None
) -> DemandInsight:
    since = (now or datetime.now(UTC)) - timedelta(days=WINDOW_DAYS)
    return DemandInsight(
        province=province,
        most_ordered=_most_ordered(db, province, since),
        most_searched=_most_searched(db, since, province),
        most_searched_luzon=_most_searched(db, since, None),
    )


@router.get("/merchants/me/demand", response_model=DemandInsight)
def get_my_demand_insight(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Most-ordered and most-searched produce in the merchant's province (30 days)."""
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return demand_insight(db, merchant.province)
