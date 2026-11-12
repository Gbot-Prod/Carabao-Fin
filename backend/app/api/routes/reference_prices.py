"""Public market reference prices (P1). Read-only; loaded from a CSV."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.reference_price import ReferencePrice
from app.schemas.reference_price import ReferencePriceResponse
from app.services import reference_prices

router = APIRouter(tags=["reference-prices"])


def _view(price: ReferencePrice) -> ReferencePriceResponse:
    return ReferencePriceResponse(
        id=price.id,
        commodity=price.commodity,
        aliases=[a for a in (price.aliases or "").split(";") if a],
        unit=price.unit,
        low=price.low,
        high=price.high,
        source=price.source,
        as_of=price.as_of,
        is_sample=reference_prices.is_sample(price),
    )


@router.get("/reference-prices", response_model=list[ReferencePriceResponse])
def list_reference_prices(db: Session = Depends(get_db)):
    """Every reference price, for clients that match listing names themselves."""
    rows = db.query(ReferencePrice).order_by(ReferencePrice.commodity).all()
    return [_view(p) for p in rows]


@router.get("/reference-prices/match", response_model=ReferencePriceResponse | None)
def match_reference_price(
    name: str = Query(min_length=1, max_length=200),
    unit: str | None = Query(None, max_length=20),
    db: Session = Depends(get_db),
):
    """The reference price for a produce name, or null when none matches."""
    found = reference_prices.match(db.query(ReferencePrice).all(), name, unit)
    return _view(found) if found else None
