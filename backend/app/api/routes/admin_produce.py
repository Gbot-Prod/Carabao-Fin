"""Admin listing moderation (A6): browse every listing, hide or unhide one.

Guardrails Phase 1: the review queue. Listings the checker flagged are
``under_review``; an admin approves (live) or rejects them (with a reason from
``listing_checks.REJECTION_CODES``). The merchant gets a notification for each.

Guardrails Phase 3: buyer reports (services/listing_reports.py) use the same
queue. An approve, reject or hide closes the open reports on the listing.
"""

from collections import defaultdict
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import nulls_last
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_db
from app.api.routes.admin import _require_admin
from app.core.sql import ilike_contains
from app.models.listing_report import ListingReport
from app.models.produce import Produce
from app.models.reference_price import ReferencePrice
from app.models.statuses import ProduceStatus
from app.models.user import User
from app.schemas.pagination import MAX_ID, MAX_PAGE, Page
from app.schemas.produce import MerchantProduceResponse
from app.services import (
    audit_log,
    listing_checks,
    listing_reports,
    listing_trust,
    listing_vision,
    notifications,
    reference_prices,
)

router = APIRouter(tags=["admin"])

# Merchant notifications all link to the dashboard; the kind picks the page
# (web lib/merchant-links.ts, merchant app notificationLinks.ts).
PRODUCE_LINK = "/merchantDashboard"


class ReferencePriceView(BaseModel):
    commodity: str
    unit: str
    low: int
    high: int
    sample: bool


class ListingReportView(BaseModel):
    id: int
    reporter_id: int
    reason: str
    label: str
    note: str | None = None
    created_at: datetime


class PhotoCheckView(BaseModel):
    """Guardrails Phase 4: the last vision check (services/listing_vision.py)."""

    shows_named_produce: str | None = None
    detected_produce: str | None = None
    has_contact_text: bool | None = None
    note: str | None = None
    model: str | None = None
    checked_at: datetime | None = None
    cleared: bool = False
    # False: the photo, name or category changed after the check.
    current: bool = False


class AdminProduceResponse(MerchantProduceResponse):
    merchant_name: str | None = None
    photo_check: PhotoCheckView | None = None
    reference_price: ReferencePriceView | None = None
    # Guardrails Phase 3: open buyer reports, oldest first.
    open_reports: list[ListingReportView] = []


class HidePayload(BaseModel):
    reason: str = Field(min_length=1, max_length=500)

    model_config = ConfigDict(extra="forbid")  # CF-0063


class RejectPayload(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    note: str | None = Field(default=None, max_length=listing_checks.REJECTION_NOTE_MAX)

    model_config = ConfigDict(extra="forbid")


class RejectionCode(BaseModel):
    code: str
    label: str
    # Guardrails Phase 2: penalty points a rejection with this reason gives.
    points: int = 0


def _report_view(report: ListingReport) -> ListingReportView:
    return ListingReportView(
        id=report.id,
        reporter_id=report.reporter_id,
        reason=report.reason,
        label=listing_reports.REPORT_REASONS.get(report.reason, report.reason),
        note=report.note,
        created_at=report.created_at,
    )


def _reports_by_listing(
    db: Session, produce_ids: list[int]
) -> dict[int, list[ListingReportView]]:
    grouped: dict[int, list[ListingReportView]] = defaultdict(list)
    for report in listing_reports.open_reports(db, produce_ids):
        grouped[report.produce_id].append(_report_view(report))
    return grouped


def _view(
    produce: Produce,
    prices: list[ReferencePrice] | None = None,
    reports: list[ListingReportView] | None = None,
) -> AdminProduceResponse:
    reference = (
        reference_prices.match(prices, produce.name, produce.unit) if prices else None
    )
    return AdminProduceResponse.model_validate(produce).model_copy(
        update={
            "merchant_name": produce.merchant.merchant_name
            if produce.merchant
            else None,
            "reference_price": ReferencePriceView(
                commodity=reference.commodity,
                unit=reference.unit,
                low=reference.low,
                high=reference.high,
                sample=reference_prices.is_sample(reference),
            )
            if reference
            else None,
            "open_reports": reports or [],
            "photo_check": _photo_check_view(produce),
        }
    )


def _photo_check_view(produce: Produce) -> PhotoCheckView | None:
    view = listing_vision.admin_view(produce)
    return PhotoCheckView.model_validate(view) if view else None


def _moderation_state(produce: Produce) -> dict:
    return {
        "status": produce.status,
        "hidden_at": produce.hidden_at,
        "hidden_reason": produce.hidden_reason,
        "rejection_code": produce.rejection_code,
        "rejection_reason": produce.rejection_reason,
    }


@router.get("/admin/produce/rejection-codes", response_model=list[RejectionCode])
def list_rejection_codes(_: User = Depends(_require_admin)):
    return [
        RejectionCode(code=code, label=label, points=listing_trust.points_for(code))
        for code, label in listing_checks.REJECTION_CODES.items()
    ]


@router.get("/admin/produce", response_model=Page[AdminProduceResponse])
def list_all_produce(
    merchant_id: int | None = Query(None, ge=1, le=MAX_ID),
    hidden: bool | None = None,
    status: ProduceStatus | None = None,
    q: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1, le=MAX_PAGE),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    """Every listing; ``status=under_review`` is the review queue (oldest first)."""
    query = db.query(Produce)
    if merchant_id is not None:
        query = query.filter(Produce.merchant_id == merchant_id)
    if hidden is True:
        query = query.filter(Produce.hidden_at.isnot(None))
    elif hidden is False:
        query = query.filter(Produce.hidden_at.is_(None))
    if status is not None:
        query = query.filter(Produce.status == status)
    if q and q.strip():
        query = query.filter(ilike_contains(Produce.name, q.strip()))
    total = query.count()
    order = (
        (nulls_last(Produce.submitted_for_review_at.asc()), Produce.id.asc())
        if status == ProduceStatus.UNDER_REVIEW
        else (Produce.id.desc(),)
    )
    rows = (
        query.options(joinedload(Produce.merchant))
        .order_by(*order)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    prices = db.query(ReferencePrice).all()
    reports = _reports_by_listing(db, [p.id for p in rows])
    return {
        "items": [_view(p, prices, reports.get(p.id)) for p in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def _get(db: Session, produce_id: int) -> Produce:
    produce = db.get(Produce, produce_id)
    if produce is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    return produce


def _merchant_user_id(produce: Produce) -> int | None:
    return produce.merchant.user_id if produce.merchant else None


def _done(db: Session, produce: Produce) -> AdminProduceResponse:
    db.commit()
    db.refresh(produce)
    return _view(
        produce,
        db.query(ReferencePrice).all(),
        _reports_by_listing(db, [produce.id]).get(produce.id),
    )


@router.post("/admin/produce/{produce_id}/approve", response_model=AdminProduceResponse)
def approve_produce(
    produce_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    produce = _get(db, produce_id)
    if produce.status != ProduceStatus.UNDER_REVIEW:
        raise HTTPException(status_code=409, detail="Listing is not under review")
    before = _moderation_state(produce)
    produce.status = ProduceStatus.LIVE
    produce.review_flags = []
    # Phase 4: an approved photo does not get its vision flags back.
    listing_vision.clear(produce)
    produce.reviewed_at = datetime.now(UTC)
    produce.reviewed_by = admin.id
    # Phase 2: the first approval counts toward the new-farm review.
    produce.approved_at = produce.approved_at or produce.reviewed_at
    listing_reports.resolve(db, produce, admin, listing_reports.RESOLVED_APPROVED)
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.PRODUCE_APPROVE,
        target_type="produce",
        target_id=produce.id,
        before=before,
        after=_moderation_state(produce),
    )
    notifications.notify(
        db,
        _merchant_user_id(produce),
        notifications.LISTING_APPROVED,
        f"Listing approved: {produce.name}",
        "An admin checked your listing. It stays live for buyers.",
        PRODUCE_LINK,
    )
    return _done(db, produce)


@router.post("/admin/produce/{produce_id}/reject", response_model=AdminProduceResponse)
def reject_produce(
    produce_id: int,
    payload: RejectPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    label = listing_checks.REJECTION_CODES.get(payload.code)
    if label is None:
        raise HTTPException(status_code=422, detail="Choose a reason from the list")
    note = (payload.note or "").strip()
    if payload.code == "OTHER" and len(note) < listing_checks.REJECTION_NOTE_MIN:
        raise HTTPException(
            status_code=422,
            detail=f"Write a note of at least {listing_checks.REJECTION_NOTE_MIN} "
            "characters for 'Other'",
        )
    produce = _get(db, produce_id)
    if produce.status not in (ProduceStatus.UNDER_REVIEW, ProduceStatus.LIVE):
        raise HTTPException(
            status_code=409,
            detail="Only a live or under-review listing can be rejected",
        )
    before = _moderation_state(produce)
    reason = note if payload.code == "OTHER" else f"{label} {note}".strip()
    produce.status = ProduceStatus.REJECTED
    produce.review_flags = listing_reports.without_report_flag(produce.review_flags)
    listing_reports.resolve(db, produce, admin, listing_reports.RESOLVED_REJECTED)
    produce.rejection_code = payload.code
    produce.rejection_reason = reason
    produce.reviewed_at = datetime.now(UTC)
    produce.reviewed_by = admin.id
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.PRODUCE_REJECT,
        target_type="produce",
        target_id=produce.id,
        before=before,
        after=_moderation_state(produce),
    )
    # Phase 2: a confirmed violation gives penalty points (listing_trust).
    penalty = listing_trust.record_penalty(db, produce, payload.code, admin)
    points_text = (
        f" This gives {penalty.points} penalty points for "
        f"{listing_trust.PENALTY_WINDOW_DAYS} days."
        if penalty
        else ""
    )
    notifications.notify(
        db,
        _merchant_user_id(produce),
        notifications.LISTING_REJECTED,
        f"Listing not approved: {produce.name}",
        f"{reason} Buyers cannot see it. Edit the listing and save it to send "
        f"it again.{points_text}",
        PRODUCE_LINK,
    )
    return _done(db, produce)


@router.post("/admin/produce/{produce_id}/hide", response_model=AdminProduceResponse)
def hide_produce(
    produce_id: int,
    payload: HidePayload,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="A reason is required")
    produce = _get(db, produce_id)
    if produce.hidden_at is not None:
        raise HTTPException(status_code=409, detail="Listing is already hidden")
    before = _moderation_state(produce)
    produce.hidden_at = datetime.now(UTC)
    produce.hidden_reason = reason
    produce.hidden_by = admin.id
    produce.status = ProduceStatus.HIDDEN
    produce.review_flags = listing_reports.without_report_flag(produce.review_flags)
    listing_reports.resolve(db, produce, admin, listing_reports.RESOLVED_HIDDEN)
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.PRODUCE_HIDE,
        target_type="produce",
        target_id=produce.id,
        before=before,
        after=_moderation_state(produce),
    )
    return _done(db, produce)


@router.post("/admin/produce/{produce_id}/unhide", response_model=AdminProduceResponse)
def unhide_produce(
    produce_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    produce = _get(db, produce_id)
    if produce.hidden_at is None:
        raise HTTPException(status_code=409, detail="Listing is not hidden")
    before = _moderation_state(produce)
    produce.hidden_at = None
    produce.hidden_reason = None
    produce.hidden_by = None
    # The admin chose to show it again: live.
    produce.status = ProduceStatus.LIVE
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.PRODUCE_UNHIDE,
        target_type="produce",
        target_id=produce.id,
        before=before,
        after=_moderation_state(produce),
    )
    return _done(db, produce)
