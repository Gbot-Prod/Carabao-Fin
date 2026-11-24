"""Admin view of listing penalty points (guardrails Phase 2).

* ``GET /admin/penalties/accounts``: merchants with active points, the most
  first. At ``listing_trust.ACCOUNT_REVIEW_POINTS`` an admin reviews the
  account and decides to suspend (the current suspend action).
* ``GET /admin/penalties``: the penalty rows, newest first.
* ``POST /admin/penalties/{id}/revoke``: remove the points of one row (an
  appeal). The row stays for the history.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.routes.admin import _require_admin
from app.models.listing_penalty import ListingPenalty
from app.models.merchant import Merchant
from app.models.user import User
from app.schemas.pagination import MAX_ID, MAX_PAGE, Page
from app.schemas.produce import ListingPenaltyView
from app.services import listing_trust

router = APIRouter(tags=["admin"])


class AdminPenalty(ListingPenaltyView):
    merchant_id: int
    merchant_name: str | None = None
    active: bool


class PenaltyAccount(BaseModel):
    merchant_id: int
    merchant_name: str | None = None
    points: int
    blocked_until: datetime | None = None
    can_create_listings: bool
    needs_account_review: bool
    shop_suspended: bool
    owner_suspended: bool


class RevokePayload(BaseModel):
    reason: str = Field(
        min_length=listing_trust.REVOKE_REASON_MIN,
        max_length=listing_trust.REVOKE_REASON_MAX,
    )

    model_config = ConfigDict(extra="forbid")


def _cutoff() -> datetime:
    return datetime.now(UTC) - timedelta(days=listing_trust.PENALTY_WINDOW_DAYS)


def _is_active(penalty: ListingPenalty) -> bool:
    return penalty.revoked_at is None and listing_trust.expires_at(
        penalty
    ) > datetime.now(UTC)


def _view(penalty: ListingPenalty, names: dict[int, str]) -> AdminPenalty:
    return AdminPenalty(
        **listing_trust.penalty_view(penalty),
        merchant_id=penalty.merchant_id,
        merchant_name=names.get(penalty.merchant_id),
        active=_is_active(penalty),
    )


def _names(db: Session, merchant_ids: set[int]) -> dict[int, str]:
    if not merchant_ids:
        return {}
    rows = (
        db.query(Merchant.id, Merchant.merchant_name)
        .filter(Merchant.id.in_(merchant_ids))
        .all()
    )
    return {row.id: row.merchant_name for row in rows}


@router.get("/admin/penalties/accounts", response_model=list[PenaltyAccount])
def list_penalty_accounts(
    min_points: int = Query(1, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    """Merchants with at least ``min_points`` active points, the most first."""
    totals = (
        db.query(ListingPenalty.merchant_id, func.sum(ListingPenalty.points))
        .filter(
            ListingPenalty.revoked_at.is_(None),
            ListingPenalty.created_at > _cutoff(),
        )
        .group_by(ListingPenalty.merchant_id)
        .having(func.sum(ListingPenalty.points) >= min_points)
        .order_by(func.sum(ListingPenalty.points).desc())
        .limit(200)
        .all()
    )
    merchants = {
        m.id: m
        for m in db.query(Merchant)
        .filter(Merchant.id.in_([row[0] for row in totals]))
        .all()
    }
    owners = {
        u.id: u
        for u in db.query(User)
        .filter(User.id.in_([m.user_id for m in merchants.values() if m.user_id]))
        .all()
    }
    accounts = []
    for merchant_id, _points in totals:
        merchant = merchants.get(merchant_id)
        current = listing_trust.standing(db, merchant_id)
        owner = owners.get(merchant.user_id) if merchant else None
        accounts.append(
            PenaltyAccount(
                merchant_id=merchant_id,
                merchant_name=merchant.merchant_name if merchant else None,
                points=current.points,
                blocked_until=current.blocked_until,
                can_create_listings=current.can_create_listings,
                needs_account_review=current.needs_account_review,
                shop_suspended=bool(merchant and merchant.suspended_at),
                owner_suspended=bool(owner and owner.is_suspended),
            )
        )
    return accounts


@router.get("/admin/penalties", response_model=Page[AdminPenalty])
def list_penalties(
    merchant_id: int | None = Query(None, ge=1, le=MAX_ID),
    active: bool | None = None,
    page: int = Query(1, ge=1, le=MAX_PAGE),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    query = db.query(ListingPenalty)
    if merchant_id is not None:
        query = query.filter(ListingPenalty.merchant_id == merchant_id)
    if active is True:
        query = query.filter(
            ListingPenalty.revoked_at.is_(None),
            ListingPenalty.created_at > _cutoff(),
        )
    elif active is False:
        query = query.filter(
            (ListingPenalty.revoked_at.isnot(None))
            | (ListingPenalty.created_at <= _cutoff())
        )
    total = query.count()
    rows = (
        query.order_by(ListingPenalty.created_at.desc(), ListingPenalty.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    names = _names(db, {row.merchant_id for row in rows})
    return {
        "items": [_view(row, names) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/admin/penalties/{penalty_id}/revoke", response_model=AdminPenalty)
def revoke_penalty(
    penalty_id: int,
    payload: RevokePayload,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    penalty = db.get(ListingPenalty, penalty_id)
    if penalty is None:
        raise HTTPException(status_code=404, detail="Penalty not found")
    if penalty.revoked_at is not None:
        raise HTTPException(status_code=409, detail="Penalty is already removed")
    if not payload.reason.strip():
        raise HTTPException(status_code=422, detail="Write a reason")
    listing_trust.revoke_penalty(db, penalty, admin=admin, reason=payload.reason)
    db.commit()
    db.refresh(penalty)
    return _view(penalty, _names(db, {penalty.merchant_id}))
