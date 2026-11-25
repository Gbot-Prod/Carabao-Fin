"""Market reference prices (P1).

Public: read-only list and match. Admin (guardrails Phase 4): import a CSV
that replaces the table, sync from the DA Price Index API, and the status of
the price flags.
"""

from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.routes.admin import _require_admin
from app.models.reference_price import ReferencePrice
from app.models.user import User
from app.schemas.reference_price import ReferencePriceResponse
from app.services import (
    audit_log,
    da_price_sync,
    listing_checks,
    rate_limit,
    reference_prices,
    upload_validation,
)
from app.services.produce_freshness import ph_today

IMPORT_MAX_BYTES = 1024 * 1024

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
    request: Request,
    name: str = Query(min_length=1, max_length=200),
    unit: str | None = Query(None, max_length=20),
    db: Session = Depends(get_db),
):
    """The reference price for a produce name, or null when none matches."""
    rate_limit.enforce_action(
        db, "reference_price_match", rate_limit.client_ip(request)
    )
    found = reference_prices.match(db.query(ReferencePrice).all(), name, unit)
    return _view(found) if found else None


class ReferencePriceStatus(BaseModel):
    total: int
    sample: int
    real: int
    # Real, per-kg rows young enough for the price flags.
    usable: int
    newest_as_of: date | None = None
    max_age_days: int
    price_flags_active: bool
    source_url: str


def _status(rows: list[ReferencePrice]) -> ReferencePriceStatus:
    sample = sum(1 for r in rows if reference_prices.is_sample(r))
    usable = listing_checks.usable_reference_rows(rows, ph_today())
    return ReferencePriceStatus(
        total=len(rows),
        sample=sample,
        real=len(rows) - sample,
        usable=len(usable),
        newest_as_of=max((r.as_of for r in rows), default=None),
        max_age_days=listing_checks.REFERENCE_MAX_AGE_DAYS,
        price_flags_active=bool(usable),
        source_url=reference_prices.DA_PRICE_MONITORING_URL,
    )


@router.get("/admin/reference-prices/status", response_model=ReferencePriceStatus)
def reference_price_status(
    db: Session = Depends(get_db), _: User = Depends(_require_admin)
):
    """Whether the price flags are on, and why not."""
    return _status(db.query(ReferencePrice).all())


@router.post("/admin/reference-prices/import", response_model=ReferencePriceStatus)
def import_reference_prices(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Replace every reference price with the rows of a CSV.

    Columns: commodity, aliases (";" between names), unit, low, high, source,
    as_of (YYYY-MM-DD). The whole file is checked first: one bad line and
    nothing changes.
    """
    data = upload_validation.read_upload(file, IMPORT_MAX_BYTES, "Price file")
    try:
        rows = reference_prices.parse_text(data.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=422, detail="Save the file as UTF-8 CSV"
        ) from exc
    except reference_prices.ReferencePriceFileError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not rows:
        raise HTTPException(status_code=422, detail="The file has no price rows")
    before = _status(db.query(ReferencePrice).all())
    try:
        reference_prices.load_rows(db, rows, commit=False)
    except reference_prices.ReferencePriceFileError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    after = _status(db.query(ReferencePrice).all())
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.REFERENCE_PRICES_IMPORT,
        target_type="reference_prices",
        target_id=None,
        before=before.model_dump(),
        after=after.model_dump(),
    )
    db.commit()
    return after


class DaSyncResponse(BaseModel):
    region: str
    as_of: date | None = None
    groups: int
    skipped_unavailable: int
    skipped_drift: int
    # DA rows not per kg (the price flags compare per kg only).
    skipped_unit: list[str]
    rows_kept: int
    # In-house rows (app/data/inhouse_reference_prices.csv) written, and the
    # ones left out because DA has that produce now.
    inhouse: int
    inhouse_overlap: list[str]
    status: ReferencePriceStatus


@router.post("/admin/reference-prices/sync-da", response_model=DaSyncResponse)
def sync_da_reference_prices(
    region: str = Query(da_price_sync.DEFAULT_REGION, min_length=2, max_length=10),
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Replace the SAMPLE, DA and in-house rows: latest DA report + in-house CSV.

    Rows that an admin imported with another source stay. If the API fails or
    gives too few produce prices, nothing changes.
    """
    before = _status(db.query(ReferencePrice).all())
    try:
        result = da_price_sync.sync(db, region=region, commit=False)
    except da_price_sync.DaPriceSyncError as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except reference_prices.ReferencePriceFileError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500, detail=f"In-house price file: {exc}"
        ) from exc
    after = _status(db.query(ReferencePrice).all())
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.REFERENCE_PRICES_SYNC,
        target_type="reference_prices",
        target_id=None,
        before=before.model_dump(),
        after={**after.model_dump(), **da_price_sync.sync_summary(result)},
    )
    db.commit()
    return DaSyncResponse(
        region=result.region,
        as_of=result.as_of,
        groups=result.groups,
        skipped_unavailable=result.skipped_unavailable,
        skipped_drift=result.skipped_drift,
        skipped_unit=result.skipped_unit,
        rows_kept=result.rows_kept,
        inhouse=result.inhouse,
        inhouse_overlap=result.inhouse_overlap,
        status=after,
    )
