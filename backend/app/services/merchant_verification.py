"""Access is separate from selling.

A seller gets a ``Merchant`` row (and so the Merchant Centre) as soon as they
save the first onboarding step, with Submit now or Submit later. Selling
needs ``verification_status == verified``, which only an admin's approval
sets. Selling means:

* publishing the shop page (merchant_shop.publish_my_shoppage);
* produce and the shop appearing to buyers (account_suspension.merchant_is_public);
* taking orders (_order_helpers.merchant_takes_orders);
* requesting payouts (merchant_payouts / payout_service);
* vouchers buyers can use (merchant_vouchers).

Before verification a merchant may draft the shop page, add produce (it
stays private), set up payout details and look at every dashboard page.

``sync_verification_status`` is the only writer of ``verification_status``.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import ColumnElement
from sqlalchemy.orm import Session

from app.core.errors import FieldErrors
from app.models.merchant import Merchant
from app.models.shopPage import ShopPage, ShopSlugHistory
from app.models.statuses import (
    APPLICATION_TO_VERIFICATION,
    MerchantVerificationStatus,
)
from app.schemas.shopPage import MAX_SLUG, MAX_TITLE, MIN_SLUG

V = MerchantVerificationStatus

NOT_VERIFIED_DETAIL = (
    "Your shop can go live once Carabao approves your business documents."
)
PUBLISH_NOT_VERIFIED_DETAIL = (
    "Your shop can be published once Carabao approves your documents."
)
PAYOUT_NOT_VERIFIED_DETAIL = (
    "Payouts start once Carabao approves your business documents."
)
VOUCHER_NOT_VERIFIED_DETAIL = (
    "Vouchers can be turned on once Carabao approves your business documents. "
    "You can save this one turned off for now."
)

# A suspended merchant may still be paid what it already earned (CF-0054).
_PAYOUT_STATUSES = frozenset({V.VERIFIED, V.SUSPENDED})


def merchant_can_sell(merchant: Any) -> bool:
    """Verified, not closed, not suspended. The one selling gate."""
    return (
        merchant is not None
        and getattr(merchant, "verification_status", None) == V.VERIFIED
        and getattr(merchant, "deleted_at", None) is None
        and getattr(merchant, "suspended_at", None) is None
    )


def merchant_selling_clause() -> ColumnElement[bool]:
    """SQL form of merchant_can_sell's verification part (for public queries)."""
    clause: ColumnElement[bool] = Merchant.verification_status == V.VERIFIED
    return clause


def merchant_can_request_payout(merchant: Any) -> bool:
    """Verified merchants, and suspended ones for money already earned."""
    return (
        merchant is not None
        and getattr(merchant, "verification_status", None) in _PAYOUT_STATUSES
    )


def require_can_sell(merchant: Any, detail: str = NOT_VERIFIED_DETAIL) -> None:
    if not merchant_can_sell(merchant):
        raise HTTPException(status_code=403, detail=detail)


# --- the status ---------------------------------------------------------------


def verification_for(application_status: str) -> MerchantVerificationStatus:
    return APPLICATION_TO_VERIFICATION.get(application_status, V.SETUP)


def sync_verification_status(
    merchant: Any, application: Any
) -> MerchantVerificationStatus:
    """Set the merchant's status from its application's. The only writer.

    A suspension also sets ``suspended_at`` (the shop goes offline and
    get_editable_merchant refuses changes, as before).
    """
    status = verification_for(str(application.status))
    merchant.verification_status = status
    if status == V.SUSPENDED and merchant.suspended_at is None:
        merchant.suspended_at = datetime.now(UTC)
    return status


# --- creating the merchant at onboarding --------------------------------------

# Step 1 fields: on the merchant from the first save. The reviewed tax and
# document fields are copied only at approval (apply_reviewed_fields).
_ACCESS_FIELDS = (
    "merchant_name",
    "seller_type",
    "contact_email",
    "contact_number",
    "region",
    "province",
    "city",
    "barangay",
    "region_code",
    "province_code",
    "city_code",
    "barangay_code",
    "address",
    "postal_code",
    "lat",
    "lng",
    "road_lat",
    "road_lng",
    "pin_confirmed",
    "pin_area_mismatch",
    "available_days",
)

# Copied when an admin approves: what the admin reviewed.
_REVIEWED_FIELDS = (
    "merchant_name",
    "legal_business_name",
    "seller_type",
    "vat_status",
    "small_agri_producer",
    "small_agri_declared_year",
    "tin",
    "registration_type",
    "registration_number",
    "rsbsa_number",
    "rsbsa_document_path",
    "rsbsa_document_original_name",
    "rsbsa_document_content_type",
    # The R2 keys and metadata, not the files.
    "gov_id_type",
    "gov_id_document_path",
    "gov_id_document_original_name",
    "gov_id_document_content_type",
    "bir_cert_document_path",
    "bir_cert_document_original_name",
    "bir_cert_document_content_type",
    "selfie_document_path",
    "selfie_document_original_name",
    "selfie_document_content_type",
)

CONTACT_NUMBER_TAKEN = "This number is already used by another shop."


def _check_contact_number_free(
    db: Session, user_id: int, contact_number: str | None
) -> None:
    """merchants.contact_number is unique: name the field instead of a 400."""
    if not contact_number:
        return
    taken = (
        db.query(Merchant.id)
        .filter(
            Merchant.contact_number == contact_number,
            Merchant.user_id != user_id,
        )
        .first()
    )
    if taken:
        raise FieldErrors({"contact_number": CONTACT_NUMBER_TAKEN}, status_code=409)


def ensure_merchant_for_application(db: Session, application: Any) -> Merchant:
    """The application's merchant, created (with a draft shop page) if missing.

    Called by the onboarding route in the same transaction as the application
    save, for Submit now and Submit later. Step 1 fields are refreshed on every
    save; the merchant's status is set by sync_verification_status.
    """
    _check_contact_number_free(db, application.user_id, application.contact_number)
    merchant = (
        db.query(Merchant).filter(Merchant.user_id == application.user_id).first()
    )
    if merchant is None:
        merchant = Merchant(
            user_id=application.user_id,
            operating_hours={},
            verification_status=V.SETUP,
        )
        db.add(merchant)
    elif merchant.deleted_at is not None:
        # A closed account applying again: the row (user_id is unique) is
        # reopened, not verified. Its approved documents stay until approval
        # copies the new ones.
        merchant.deleted_at = None
        merchant.verified_at = None
        merchant.verified_by_user_id = None
    for field in _ACCESS_FIELDS:
        value = getattr(application, field)
        if field == "merchant_name" and not value:
            continue
        setattr(merchant, field, value)
    db.flush()
    application.merchant_id = merchant.id
    if merchant.shop_page is None:
        create_draft_shop_page(db, merchant)
    return merchant


def apply_reviewed_fields(merchant: Any, application: Any) -> None:
    """Approval: copy what the admin reviewed (seller type, tax, documents)."""
    for field in _ACCESS_FIELDS + _REVIEWED_FIELDS:
        setattr(merchant, field, getattr(application, field))


# --- the draft shop page ------------------------------------------------------


def slugify(text: str) -> str:
    """'Dela Cruz Farm!' -> 'dela-cruz-farm' (same rule as web lib/shop-slug.ts)."""
    ascii_text = (
        unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    )
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug[:MAX_SLUG].strip("-")


def _slug_taken(db: Session, slug: str) -> bool:
    return (
        db.query(ShopPage.id).filter(ShopPage.slug == slug).first() is not None
        or db.query(ShopSlugHistory.id).filter(ShopSlugHistory.slug == slug).first()
        is not None
    )


def unique_slug(db: Session, title: str, fallback: str) -> str:
    base = slugify(title)
    if len(base) < MIN_SLUG or base.isdigit():
        base = fallback
    candidate, n = base, 2
    while _slug_taken(db, candidate):
        suffix = f"-{n}"
        candidate = f"{base[: MAX_SLUG - len(suffix)]}{suffix}"
        n += 1
    return candidate


def create_draft_shop_page(db: Session, merchant: Any) -> ShopPage:
    """An unpublished shop page titled with the shop name. Buyers see nothing
    until the merchant publishes, which needs verification."""
    title = (str(merchant.merchant_name or "").strip() or "My farm")[:MAX_TITLE]
    page = ShopPage(
        merchant_id=merchant.id,
        slug=unique_slug(db, title, fallback=f"farm-{merchant.id}"),
        title=title,
        draft_title=title,
    )
    db.add(page)
    db.flush()
    merchant.shop_page = page
    return page
