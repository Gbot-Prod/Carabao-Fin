"""Low-stock and expiry alerts for the merchant dashboard (F1).

Expired listings are already hidden from buyers by ``is_listed``
(services/produce_freshness.py); this only tells the farmer about them.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.produce import Produce
from app.models.user import User
from app.services.merchant_service import get_active_merchant
from app.services.produce_freshness import ph_today

router = APIRouter(tags=["merchants"])

EXPIRY_WARNING_DAYS = 2


class StockAlertItem(BaseModel):
    id: int
    name: str
    unit: str
    stock_quantity: int
    best_before: date | None = None
    days_left: int | None = None


class StockAlerts(BaseModel):
    low_stock_threshold: int
    expiry_warning_days: int = EXPIRY_WARNING_DAYS
    low_stock: list[StockAlertItem]
    expiring_soon: list[StockAlertItem]
    expired: list[StockAlertItem]


class ThresholdUpdate(BaseModel):
    low_stock_threshold: int = Field(ge=0, le=100_000)


def _item(p: Produce, today: date) -> StockAlertItem:
    return StockAlertItem(
        id=p.id,
        name=p.name,
        unit=p.unit,
        stock_quantity=p.stock_quantity,
        best_before=p.best_before,
        days_left=(p.best_before - today).days if p.best_before else None,
    )


def stock_alerts(produces: list[Produce], threshold: int, today: date) -> StockAlerts:
    low, soon, expired = [], [], []
    for p in produces:
        if p.best_before is not None and p.best_before < today:
            expired.append(_item(p, today))
            continue  # already off sale; no stock warning on top
        if (
            p.best_before is not None
            and (p.best_before - today).days <= EXPIRY_WARNING_DAYS
        ):
            soon.append(_item(p, today))
        if threshold > 0 and p.stock_quantity <= threshold:
            low.append(_item(p, today))
    low.sort(key=lambda i: (i.stock_quantity, i.name))
    soon.sort(key=lambda i: (i.days_left, i.name))
    expired.sort(key=lambda i: (i.best_before, i.name), reverse=True)
    return StockAlerts(
        low_stock_threshold=threshold,
        low_stock=low,
        expiring_soon=soon,
        expired=expired,
    )


def _merchant(db: Session, user: User):
    merchant = get_active_merchant(db, user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return merchant


@router.get("/merchants/me/stock-alerts", response_model=StockAlerts)
def get_stock_alerts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Listings that are low on stock, near their best-before date, or expired.

    Hidden (moderated) listings are left out; the dashboard shows those separately.
    """
    merchant = _merchant(db, current_user)
    produces = (
        db.query(Produce)
        .filter(Produce.merchant_id == merchant.id, Produce.hidden_at.is_(None))
        .all()
    )
    threshold = merchant.low_stock_threshold
    if threshold is None:
        threshold = 5
    return stock_alerts(produces, threshold, ph_today())


@router.patch("/merchants/me/stock-alerts", response_model=StockAlerts)
def set_low_stock_threshold(
    payload: ThresholdUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set the stock level at or below which a listing is flagged (0 turns it off)."""
    merchant = _merchant(db, current_user)
    merchant.low_stock_threshold = payload.low_stock_threshold
    db.commit()
    return get_stock_alerts(db, current_user)
