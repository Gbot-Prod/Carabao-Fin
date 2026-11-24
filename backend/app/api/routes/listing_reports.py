"""Buyer reports on listings (produce guardrails Phase 3).

See services/listing_reports.py for what a report does.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.user import User
from app.services import listing_reports, rate_limit
from app.services.account_suspension import merchant_is_public
from app.services.produce_freshness import is_listed, ph_today

router = APIRouter(tags=["produce"])


class ReportReason(BaseModel):
    code: str
    label: str


class ReportPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=40)
    note: str | None = Field(default=None, max_length=listing_reports.NOTE_MAX)

    model_config = ConfigDict(extra="forbid")


@router.get("/produce/report-reasons", response_model=list[ReportReason])
def list_report_reasons():
    return [
        ReportReason(code=code, label=label)
        for code, label in listing_reports.REPORT_REASONS.items()
    ]


@router.post("/produce/{produce_id}/report", status_code=204)
def report_listing(
    produce_id: int,
    payload: ReportPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Report a listing buyers can see. 404 for one they cannot see."""
    rate_limit.enforce_action(db, "listing_report", str(current_user.id))
    produce = (
        db.query(Produce)
        .join(Merchant, Merchant.id == Produce.merchant_id)
        .options(joinedload(Produce.merchant))
        .filter(
            Produce.id == produce_id,
            merchant_is_public(),  # type: ignore[no-untyped-call]
            is_listed(ph_today()),
        )
        .first()
    )
    if produce is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    listing_reports.add_report(db, produce, current_user, payload.reason, payload.note)
    db.commit()
