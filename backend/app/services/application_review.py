"""Merchant application statuses and the moves allowed between them (CF-0010).

``submitted`` is the pending state: the applicant sent the form and an admin
has yet to decide. ``pending_documents`` is an application saved with
"Submit later": step 1 and the seller type only. It cannot be reviewed, and
the applicant cannot sell, until they send the business information.

Admin moves (PATCH /admin/merchant-applications/{id}):
    submitted -> approved | rejected | clarification
    approved  -> suspended   (also suspends the merchant)

Applicant moves (POST /merchant-onboarding/me):
    (none) | rejected | clarification | pending_documents
        -> submitted (Submit now) | pending_documents (Submit later)
    approved -> submitted | pending_documents, only after the merchant closed
        their account

Any other move is refused with 409.

The merchant row exists from the applicant's first save
(merchant_verification.ensure_merchant_for_application); every move here
updates its ``verification_status`` through sync_verification_status.
Approving copies the reviewed fields onto it and needs every warn and fail
item of the automated checklist confirmed (document_checks.py).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.services import document_checks
from app.services.merchant_service import create_merchant_from_application
from app.services.merchant_verification import (
    apply_reviewed_fields,
    sync_verification_status,
)

SUBMITTED = "submitted"
APPROVED = "approved"
REJECTED = "rejected"
CLARIFICATION = "clarification"
SUSPENDED = "suspended"
PENDING_DOCUMENTS = "pending_documents"

ADMIN_TRANSITIONS: dict[str, frozenset[str]] = {
    SUBMITTED: frozenset({APPROVED, REJECTED, CLARIFICATION}),
    APPROVED: frozenset({SUSPENDED}),
}

# Statuses from which the applicant may send the form again.
RESUBMITTABLE = frozenset({REJECTED, CLARIFICATION, PENDING_DOCUMENTS})

NOT_SUBMITTED_DETAIL = (
    "This application has no business information yet (Submit later), so it "
    "cannot be reviewed until the applicant submits it."
)


def check_admin_transition(current: str, target: str) -> None:
    if current == PENDING_DOCUMENTS:
        raise HTTPException(status_code=409, detail=NOT_SUBMITTED_DETAIL)
    if target not in ADMIN_TRANSITIONS.get(current, frozenset()):
        raise HTTPException(
            status_code=409,
            detail=f"An application that is {current} cannot be set to {target}",
        )


def check_can_resubmit(
    application: MerchantApplication | None, has_active_merchant: bool
) -> None:
    """Refuse a (re)submission unless the application may go back to submitted."""
    if application is None:
        return
    status = application.status
    if status in RESUBMITTABLE:
        return
    # A merchant who closed their account may apply again.
    if status == APPROVED and not has_active_merchant:
        return
    if status == SUBMITTED:
        detail = "Your application is already under review"
    elif status == SUSPENDED:
        detail = "This merchant account is suspended. Contact Carabao support."
    else:
        detail = "User already has a merchant profile"
    raise HTTPException(status_code=409, detail=detail)


def _merchant_for(db: Session, application: Any) -> Merchant | None:
    query = db.query(Merchant).with_for_update()
    if application.merchant_id is not None:
        return query.filter(Merchant.id == application.merchant_id).first()
    return query.filter(Merchant.user_id == application.user_id).first()


def apply_admin_decision(
    db: Session,
    application: Any,
    target: str,
    *,
    admin_id: int | None = None,
    confirmed_items: list[str] | None = None,
) -> Merchant | None:
    """Move the application to ``target`` and do what that move requires.

    Approval refuses (409) until every warn and fail checklist item is in
    ``confirmed_items``; the confirmations are stored on the application.
    Reject and clarification never need the checklist.

    Approval can raise ValueError or IntegrityError from creating a merchant
    (an application from before merchants were made at onboarding); the caller
    rolls back.
    """
    check_admin_transition(application.status, target)
    if target == APPROVED:
        document_checks.confirm_items(application, confirmed_items or [], admin_id)
    application.status = target

    merchant = _merchant_for(db, application)
    if target == APPROVED:
        if merchant is None or merchant.deleted_at is not None:
            # Fallback for an application that has no live merchant yet.
            merchant = create_merchant_from_application(db, application)
        else:
            apply_reviewed_fields(merchant, application)
        application.merchant_id = merchant.id
        merchant.verified_by_user_id = admin_id
        merchant.verified_at = datetime.now(UTC)

    if merchant is not None:
        sync_verification_status(merchant, application)
    return merchant
