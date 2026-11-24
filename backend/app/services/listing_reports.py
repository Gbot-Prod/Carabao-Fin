"""Buyer reports on listings (produce guardrails Phase 3).

A signed-in user who does not own the listing can report a listing that buyers
can see. Each report goes into the same admin queue as the checker flags:

* a ``live`` listing goes to ``under_review``;
* the listing gets one ``BUYER_REPORT`` flag that counts the open reports;
* the first open report on a listing sends a notification to the admins.

The merchant sees the flag, but not who reported or the note. An edit by the
merchant does not remove the flag while a report is open. An admin decision
(approve, reject or hide) closes every open report on the listing.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.listing_report import ListingReport
from app.models.produce import Produce
from app.models.statuses import ProduceStatus
from app.models.user import User
from app.services import notifications
from app.services.listing_checks import Issue

BUYER_REPORT = "BUYER_REPORT"

REPORT_REASONS: dict[str, str] = {
    "NOT_AS_DESCRIBED": "The produce is not as described.",
    "MISLEADING_PHOTO": "The photo does not show this produce.",
    "PROHIBITED_ITEM": "This item cannot be sold on Carabao.",
    "CONTACT_OR_PAYMENT": "The seller asks buyers to contact or pay outside Carabao.",
    "MISLEADING_PRICE": "The price is wrong or misleading.",
    "SPAM": "The listing is spam or a duplicate.",
    "OTHER": "Other reason.",
}
NOTE_MIN = 10
NOTE_MAX = 500

RESOLVED_APPROVED = "approved"
RESOLVED_REJECTED = "rejected"
RESOLVED_HIDDEN = "hidden"

ADMIN_QUEUE_LINK = "/admin/listings?status=under_review"


def report_issue(count: int) -> Issue:
    noun = "report" if count == 1 else "reports"
    return Issue(
        field="listing",
        code=BUYER_REPORT,
        message=(
            f"Buyers reported this listing ({count} {noun}). An admin will "
            "check it. Buyers can see the listing during the check."
        ),
    )


def open_reports(db: Session, produce_ids: list[int]) -> list[ListingReport]:
    if not produce_ids:
        return []
    return (
        db.query(ListingReport)
        .filter(
            ListingReport.produce_id.in_(produce_ids),
            ListingReport.resolved_at.is_(None),
        )
        .order_by(ListingReport.id.asc())
        .all()
    )


def open_report_count(db: Session, produce_id: int) -> int:
    return (
        db.query(ListingReport)
        .filter(
            ListingReport.produce_id == produce_id,
            ListingReport.resolved_at.is_(None),
        )
        .count()
    )


def without_report_flag(flags: list[dict] | None) -> list[dict]:
    return [f for f in flags or [] if f.get("code") != BUYER_REPORT]


def with_report_flag(
    db: Session, produce_id: int, flags: list[dict] | None
) -> list[dict]:
    """``flags`` with the BUYER_REPORT flag set from the open reports."""
    kept = without_report_flag(flags)
    count = open_report_count(db, produce_id)
    if count:
        kept.append(report_issue(count).as_dict())
    return kept


def add_report(
    db: Session, produce: Produce, user: User, reason: str, note: str | None
) -> ListingReport:
    """Save a report and put the listing in the review queue. Caller commits."""
    if reason not in REPORT_REASONS:
        raise HTTPException(status_code=422, detail="Choose a reason from the list")
    note = (note or "").strip() or None
    if reason == "OTHER" and len(note or "") < NOTE_MIN:
        raise HTTPException(
            status_code=422,
            detail=f"Write a note of at least {NOTE_MIN} characters for 'Other'",
        )
    if produce.merchant is not None and produce.merchant.user_id == user.id:
        raise HTTPException(
            status_code=400, detail="You cannot report your own listing"
        )
    already = (
        db.query(ListingReport.id)
        .filter(
            ListingReport.produce_id == produce.id,
            ListingReport.reporter_id == user.id,
            ListingReport.resolved_at.is_(None),
        )
        .first()
    )
    if already is not None:
        raise HTTPException(
            status_code=409,
            detail="You already reported this listing. An admin will check it.",
        )

    report = ListingReport(
        produce_id=produce.id, reporter_id=user.id, reason=reason, note=note
    )
    db.add(report)
    db.flush()

    produce.review_flags = with_report_flag(db, produce.id, produce.review_flags)
    if produce.status == ProduceStatus.LIVE:
        produce.status = ProduceStatus.UNDER_REVIEW
        produce.submitted_for_review_at = datetime.now(UTC)
    if open_report_count(db, produce.id) == 1:
        notifications.notify_admins(
            db,
            notifications.LISTING_REPORTED,
            f"A buyer reported a listing: {produce.name}",
            REPORT_REASONS[reason],
            ADMIN_QUEUE_LINK,
        )
    return report


def resolve(db: Session, produce: Produce, admin: User, resolution: str) -> int:
    """Close every open report on ``produce``. Returns how many. Caller commits."""
    now = datetime.now(UTC)
    rows = open_reports(db, [produce.id])
    for row in rows:
        row.resolved_at = now
        row.resolved_by = admin.id
        row.resolution = resolution
    return len(rows)
