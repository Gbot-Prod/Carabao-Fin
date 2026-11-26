"""Admin word list for the listing checker (guardrails Phase 1).

Admins add a word, change its category or severity, or turn it off. There is
no delete: a row turned off keeps the history (and the audit log) readable.
The checker reads the table through a one-minute cache
(``listing_checks.active_terms``); a change here clears this worker's cache.
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.routes.admin import _require_admin
from app.core.sql import SortOrder, ilike_contains, sort_clauses
from app.models.prohibited_term import ProhibitedTerm
from app.models.user import User
from app.schemas.pagination import MAX_PAGE, Page
from app.services import audit_log, listing_checks

router = APIRouter(tags=["admin"])

Category = Literal["contact", "prohibited_commodity", "profanity", "spam"]
Severity = Literal["hard_block", "soft_flag"]
Language = Literal["en", "tl", "ceb", "all"]


class TermResponse(BaseModel):
    id: int
    term: str
    category: str
    severity: str
    language: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class TermCreate(BaseModel):
    term: str = Field(min_length=1, max_length=120)
    category: Category
    severity: Severity = "hard_block"
    language: Language = "all"

    model_config = ConfigDict(extra="forbid")


class TermUpdate(BaseModel):
    category: Category | None = None
    severity: Severity | None = None
    language: Language | None = None
    is_active: bool | None = None

    model_config = ConfigDict(extra="forbid")


def _state(term: ProhibitedTerm) -> dict:
    return {
        "term": term.term,
        "category": term.category,
        "severity": term.severity,
        "language": term.language,
        "is_active": term.is_active,
    }


TermSort = Literal["term", "category", "severity", "language", "active", "added"]


def _term_sort_column(sort: TermSort) -> Any:
    return {
        "term": ProhibitedTerm.term,
        "category": ProhibitedTerm.category,
        "severity": ProhibitedTerm.severity,
        "language": ProhibitedTerm.language,
        "active": ProhibitedTerm.is_active,
        "added": ProhibitedTerm.created_at,
    }[sort]


@router.get("/admin/prohibited-terms", response_model=Page[TermResponse])
def list_terms(
    category: Category | None = None,
    severity: Severity | None = None,
    active: bool | None = None,
    q: str | None = Query(None, max_length=120),
    sort: TermSort = "term",
    order: SortOrder = "asc",
    page: int = Query(1, ge=1, le=MAX_PAGE),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    query = db.query(ProhibitedTerm)
    if category:
        query = query.filter(ProhibitedTerm.category == category)
    if severity:
        query = query.filter(ProhibitedTerm.severity == severity)
    if active is not None:
        query = query.filter(ProhibitedTerm.is_active.is_(active))
    if q and q.strip():
        query = query.filter(ilike_contains(ProhibitedTerm.term, q.strip()))
    total = query.count()
    rows = (
        query.order_by(*sort_clauses(_term_sort_column(sort), order, ProhibitedTerm.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


@router.post("/admin/prohibited-terms", response_model=TermResponse, status_code=201)
def create_term(
    payload: TermCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    normalized = listing_checks.normalize_term(payload.term)
    if not normalized:
        raise HTTPException(status_code=422, detail="The term has no letters or digits")
    if db.query(ProhibitedTerm).filter(ProhibitedTerm.term == normalized).first():
        raise HTTPException(status_code=409, detail="This term is already in the list")
    term = ProhibitedTerm(
        term=normalized,
        category=payload.category,
        severity=payload.severity,
        language=payload.language,
        is_active=True,
    )
    db.add(term)
    db.flush()
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.TERM_CREATE,
        target_type="prohibited_term",
        target_id=term.id,
        after=_state(term),
    )
    db.commit()
    db.refresh(term)
    listing_checks.invalidate_terms_cache(db)
    return term


@router.patch("/admin/prohibited-terms/{term_id}", response_model=TermResponse)
def update_term(
    term_id: int,
    payload: TermUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    term = db.get(ProhibitedTerm, term_id)
    if term is None:
        raise HTTPException(status_code=404, detail="Term not found")
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Nothing to change")
    before = _state(term)
    for name, value in changes.items():
        setattr(term, name, value)
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.TERM_UPDATE,
        target_type="prohibited_term",
        target_id=term.id,
        before=before,
        after=_state(term),
    )
    db.commit()
    db.refresh(term)
    listing_checks.invalidate_terms_cache(db)
    return term
