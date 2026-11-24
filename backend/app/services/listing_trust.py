"""Listing trust (produce guardrails Phase 2).

Three rules sit on top of the checker in ``listing_checks``:

* **Check again after an edit.** An edit to the name, description, category,
  photo, or a price change of more than ``PRICE_CHANGE_SHARE`` is a material
  edit. A live listing with a material edit goes back to ``under_review`` when
  the new check has a soft flag. An edit to stock (or dates) only keeps the
  status.
* **New merchants.** Until an admin approved ``NEW_MERCHANT_REVIEW_COUNT`` of a
  merchant's listings (``produces.approved_at``), each new or materially
  edited listing goes to ``under_review``, also with no flags. A rejection
  does not count.
* **Penalty points.** An admin rejection with a reason in ``PENALTY_POINTS``
  adds a ``listing_penalties`` row. Points count for ``PENALTY_WINDOW_DAYS``
  days. At ``LISTING_BLOCK_POINTS`` the merchant cannot make new listings; at
  ``ACCOUNT_REVIEW_POINTS`` every admin gets a notification to review the
  account (an admin decides to suspend). A flagged listing that the merchant
  corrects before an admin acts never gets a rejection, so it gives no points.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.listing_penalty import ListingPenalty
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.statuses import ProduceStatus
from app.models.user import User
from app.services import audit_log, notifications
from app.services.listing_checks import REJECTION_CODES, Issue

# Admin rejection reason -> points. Reasons not here (wrong category, price,
# other) are honest errors and give no points.
PENALTY_POINTS: dict[str, int] = {
    "PROHIBITED_COMMODITY": 3,
    "CONTACT_INFO": 2,
    "SPAM": 1,
    "MISLEADING_PHOTO": 1,
}
PENALTY_WINDOW_DAYS = 28
LISTING_BLOCK_POINTS = 3
ACCOUNT_REVIEW_POINTS = 6
NEW_MERCHANT_REVIEW_COUNT = 3
PRICE_CHANGE_SHARE = 0.3

NEW_MERCHANT_REVIEW = "NEW_MERCHANT_REVIEW"
REVOKE_REASON_MIN = 5
REVOKE_REASON_MAX = 500

MERCHANT_LINK = "/merchantDashboard"
ADMIN_LINK = "/admin/penalties"


def points_for(code: str) -> int:
    return PENALTY_POINTS.get(code, 0)


def _aware(moment: datetime) -> datetime:
    # SQLite gives naive datetimes back; the app writes UTC.
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def expires_at(penalty: ListingPenalty) -> datetime:
    return _aware(penalty.created_at) + timedelta(days=PENALTY_WINDOW_DAYS)


def active_penalties(
    db: Session, merchant_id: int, now: datetime | None = None
) -> list[ListingPenalty]:
    """Rows that count now, oldest first."""
    cutoff = (now or datetime.now(UTC)) - timedelta(days=PENALTY_WINDOW_DAYS)
    return (
        db.query(ListingPenalty)
        .filter(
            ListingPenalty.merchant_id == merchant_id,
            ListingPenalty.revoked_at.is_(None),
            ListingPenalty.created_at > cutoff,
        )
        .order_by(ListingPenalty.created_at, ListingPenalty.id)
        .all()
    )


def blocked_until(penalties: list[ListingPenalty]) -> datetime | None:
    """When the total drops below ``LISTING_BLOCK_POINTS`` (None: not blocked).

    ``penalties`` are the active rows, oldest first; the oldest expire first.
    """
    total = sum(p.points for p in penalties)
    for penalty in penalties:
        if total < LISTING_BLOCK_POINTS:
            break
        total -= penalty.points
        if total < LISTING_BLOCK_POINTS:
            return expires_at(penalty)
    return None


def approved_listing_count(db: Session, merchant_id: int) -> int:
    return (
        db.query(func.count(Produce.id))
        .filter(
            Produce.merchant_id == merchant_id,
            Produce.approved_at.isnot(None),
            Produce.status != ProduceStatus.REJECTED,
        )
        .scalar()
        or 0
    )


def new_merchant_reviews_left(db: Session, merchant_id: int) -> int:
    return max(0, NEW_MERCHANT_REVIEW_COUNT - approved_listing_count(db, merchant_id))


def new_merchant_issue() -> Issue:
    return Issue(
        field="listing",
        code=NEW_MERCHANT_REVIEW,
        message=(
            f"An admin checks the first {NEW_MERCHANT_REVIEW_COUNT} listings of a "
            "new farm. Buyers can see this listing during the check."
        ),
    )


# ---------------------------------------------------------------------------
# Material edits
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Snapshot:
    name: str | None
    description: str | None
    category: str | None
    image_url: str | None
    price: int | None


def snapshot(produce: Produce) -> Snapshot:
    return Snapshot(
        name=produce.name,
        description=produce.description,
        category=produce.category,
        image_url=produce.image_url,
        price=produce.price,
    )


def is_material_edit(before: Snapshot, produce: Produce) -> bool:
    after = snapshot(produce)
    if (before.name, before.description, before.category, before.image_url) != (
        after.name,
        after.description,
        after.category,
        after.image_url,
    ):
        return True
    if before.price and after.price is not None:
        return abs(after.price - before.price) / before.price > PRICE_CHANGE_SHARE
    return before.price != after.price


# ---------------------------------------------------------------------------
# Standing
# ---------------------------------------------------------------------------


@dataclass
class Standing:
    points: int
    blocked_until: datetime | None
    new_merchant_reviews_left: int
    penalties: list[ListingPenalty] = field(default_factory=list)

    @property
    def can_create_listings(self) -> bool:
        return self.points < LISTING_BLOCK_POINTS

    @property
    def needs_account_review(self) -> bool:
        return self.points >= ACCOUNT_REVIEW_POINTS


def standing(db: Session, merchant_id: int, now: datetime | None = None) -> Standing:
    penalties = active_penalties(db, merchant_id, now)
    return Standing(
        points=sum(p.points for p in penalties),
        blocked_until=blocked_until(penalties),
        new_merchant_reviews_left=new_merchant_reviews_left(db, merchant_id),
        penalties=penalties,
    )


def _date_text(moment: datetime | None) -> str:
    return moment.strftime("%B %d, %Y") if moment else "the points expire"


def blocked_detail(current: Standing) -> str:
    return (
        f"You have {current.points} penalty points. You cannot make new listings "
        f"until {_date_text(current.blocked_until)}. You can still edit your "
        "current listings."
    )


# ---------------------------------------------------------------------------
# Writes (the caller commits)
# ---------------------------------------------------------------------------


def record_penalty(
    db: Session, produce: Produce, code: str, admin: User
) -> ListingPenalty | None:
    """Add the points for a rejection with ``code``; None when it gives none."""
    points = points_for(code)
    if points <= 0:
        return None
    merchant_id = produce.merchant_id
    before = sum(p.points for p in active_penalties(db, merchant_id))
    penalty = ListingPenalty(
        merchant_id=merchant_id,
        produce_id=produce.id,
        produce_name=produce.name,
        code=code,
        points=points,
        created_at=datetime.now(UTC),
        created_by=admin.id,
    )
    db.add(penalty)
    db.flush()
    after = before + points
    merchant = db.get(Merchant, merchant_id)
    user_id = merchant.user_id if merchant else None
    if before < LISTING_BLOCK_POINTS <= after:
        current = standing(db, merchant_id)
        notifications.notify(
            db,
            user_id,
            notifications.LISTING_BLOCKED,
            "You cannot make new listings for now",
            f"You have {after} penalty points. New listings are blocked until "
            f"{_date_text(current.blocked_until)}. Your current listings stay up.",
            MERCHANT_LINK,
        )
    if before < ACCOUNT_REVIEW_POINTS <= after:
        name = merchant.merchant_name if merchant else f"Merchant {merchant_id}"
        notifications.notify_admins(
            db,
            notifications.MERCHANT_ACCOUNT_REVIEW,
            f"Account to review: {name}",
            f"This farm has {after} penalty points in {PENALTY_WINDOW_DAYS} days. "
            "Check the account and decide if it must be suspended.",
            f"{ADMIN_LINK}?merchant_id={merchant_id}",
        )
    return penalty


def _penalty_state(penalty: ListingPenalty) -> dict:
    return {
        "points": penalty.points,
        "revoked_at": penalty.revoked_at,
        "revoke_reason": penalty.revoke_reason,
    }


def revoke_penalty(
    db: Session, penalty: ListingPenalty, *, admin: User, reason: str
) -> ListingPenalty:
    before = _penalty_state(penalty)
    penalty.revoked_at = datetime.now(UTC)
    penalty.revoked_by = admin.id
    penalty.revoke_reason = reason.strip()
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.PENALTY_REVOKE,
        target_type="listing_penalty",
        target_id=penalty.id,
        before=before,
        after=_penalty_state(penalty),
    )
    merchant = db.get(Merchant, penalty.merchant_id)
    notifications.notify(
        db,
        merchant.user_id if merchant else None,
        notifications.LISTING_PENALTY_REVOKED,
        f"Penalty points removed: {penalty.produce_name}",
        f"An admin removed {penalty.points} penalty points. {penalty.revoke_reason}",
        MERCHANT_LINK,
    )
    return penalty


def label_for(code: str) -> str:
    return REJECTION_CODES.get(code, code)


def penalty_view(penalty: ListingPenalty) -> dict:
    return {
        "id": penalty.id,
        "produce_id": penalty.produce_id,
        "produce_name": penalty.produce_name,
        "code": penalty.code,
        "label": label_for(penalty.code),
        "points": penalty.points,
        "created_at": _aware(penalty.created_at),
        "expires_at": expires_at(penalty),
        "revoked_at": penalty.revoked_at,
        "revoke_reason": penalty.revoke_reason,
    }


def standing_view(current: Standing) -> dict:
    return {
        "points": current.points,
        "window_days": PENALTY_WINDOW_DAYS,
        "listing_block_points": LISTING_BLOCK_POINTS,
        "account_review_points": ACCOUNT_REVIEW_POINTS,
        "can_create_listings": current.can_create_listings,
        "blocked_until": current.blocked_until,
        "new_merchant_reviews_left": current.new_merchant_reviews_left,
        "penalties": [penalty_view(p) for p in current.penalties],
    }
