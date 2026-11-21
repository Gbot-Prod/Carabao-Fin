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
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.services.merchant_service import create_merchant_from_application

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


def apply_admin_decision(
    db: Session, application: MerchantApplication, target: str
) -> None:
    """Move the application to ``target`` and do what that move requires.

    Approval can raise ValueError or IntegrityError from creating the merchant;
    the caller rolls back.
    """
    check_admin_transition(application.status, target)
    application.status = target

    if target == APPROVED and application.merchant_id is None:
        merchant = create_merchant_from_application(db, application)
        application.merchant_id = merchant.id

    if target == SUSPENDED:
        merchant = (
            db.query(Merchant)
            .filter(Merchant.user_id == application.user_id)
            .with_for_update()
            .first()
        )
        if merchant is not None and merchant.suspended_at is None:
            merchant.suspended_at = datetime.now(UTC)
