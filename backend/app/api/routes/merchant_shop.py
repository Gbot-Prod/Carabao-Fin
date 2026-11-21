"""A farm's shop page: the public read, and the owner's draft, publish,
unpublish, discard, logo and banner (CF-0079: moved from routes/merchants.py).

The merchant edits a draft (draft_* columns). Buyers see only the live
columns, and only after the first publish. POST .../publish copies the
draft to live; POST .../unpublish hides the shop from buyers again;
POST .../discard copies live back to the draft.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Path,
    UploadFile,
)
from sqlalchemy import ColumnElement
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.errors import upstream_error
from app.models.merchant import Merchant
from app.models.shopPage import DRAFT_FIELDS, ShopPage, ShopSlugHistory
from app.models.user import User
from app.schemas.shopPage import (
    MAX_SLUG,
    ShopPageCreate,
    ShopPageOwnerResponse,
    ShopPageResponse,
    ShopPageUpdate,
    ShopSlugLookup,
)
from app.services import (
    r2_service,
    rate_limit,
    upload_validation,
)
from app.services.account_suspension import merchant_is_public
from app.services.merchant_service import (
    get_active_merchant,
    get_editable_merchant,
)
from app.services.merchant_verification import (
    PUBLISH_NOT_VERIFIED_DETAIL,
    require_can_sell,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["merchants"])


def _my_shop_page(
    db: Session, user: User, *, editable: bool = False
) -> tuple[Merchant, ShopPage]:
    """``editable`` for a change: refused while the shop is suspended (CF-0054)."""
    get = get_editable_merchant if editable else get_active_merchant
    merchant = get(db, user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(
            status_code=404, detail="Shop page not found — create one first"
        )
    return merchant, shop_page


def _claim_slug(db: Session, slug: str) -> None:
    """A shop takes ``slug``: an old slug of any shop stops pointing there."""
    db.query(ShopSlugHistory).filter(ShopSlugHistory.slug == slug).delete(
        synchronize_session=False
    )


def _public_page(db: Session, where: ColumnElement[bool]) -> ShopPage | None:
    return (
        db.query(ShopPage)
        .join(Merchant, Merchant.id == ShopPage.merchant_id)
        .filter(where, merchant_is_public())  # type: ignore[no-untyped-call]
        .first()
    )


@router.get("/shops/{slug}", response_model=ShopSlugLookup)
def find_shop_by_slug(
    slug: str = Path(min_length=1, max_length=MAX_SLUG),
    db: Session = Depends(get_db),
) -> ShopSlugLookup:
    """Which public farm /farms/<slug> names: by its current slug, else by a
    slug it used before (the web page then redirects to the current one)."""
    slug = slug.lower()
    page = _public_page(db, ShopPage.slug == slug)
    if page is None:
        old = db.query(ShopSlugHistory).filter(ShopSlugHistory.slug == slug).first()
        if old is not None:
            page = _public_page(db, ShopPage.merchant_id == old.merchant_id)
    if page is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    return ShopSlugLookup(merchant_id=page.merchant_id, slug=page.slug)


def _save(db: Session, shop_page: ShopPage) -> ShopPage:
    db.commit()
    db.refresh(shop_page)
    return shop_page


# Declared before /merchants/{merchant_id}/shoppage, which would read "me" as an id.
@router.get("/merchants/me/shoppage", response_model=ShopPageOwnerResponse)
def get_my_shoppage(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _, shop_page = _my_shop_page(db, current_user)
    return shop_page


@router.get("/merchants/{merchant_id}/shoppage", response_model=ShopPageResponse)
def get_merchant_shoppage(merchant_id: int, db: Session = Depends(get_db)):
    shop_page = (
        db.query(ShopPage)
        .join(Merchant, Merchant.id == ShopPage.merchant_id)
        .filter(ShopPage.merchant_id == merchant_id, merchant_is_public())
        .first()
    )
    if not shop_page:
        raise HTTPException(status_code=404, detail="Shop page not found")
    return shop_page


@router.post("/merchants/me/shoppage", response_model=ShopPageOwnerResponse)
def create_my_shoppage(
    shop_page_in: ShopPageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_editable_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    if merchant.shop_page:
        raise HTTPException(
            status_code=400, detail="Shop page already exists — use PATCH to update"
        )

    existing_slug = (
        db.query(ShopPage).filter(ShopPage.slug == shop_page_in.slug).first()
    )
    if existing_slug:
        raise HTTPException(status_code=400, detail="Slug already taken")

    _claim_slug(db, shop_page_in.slug)
    # A new page is a draft only. The live title column cannot be empty, but
    # buyers see nothing until the first publish.
    shop_page = ShopPage(
        merchant_id=merchant.id,
        slug=shop_page_in.slug,
        title=shop_page_in.title,
        draft_title=shop_page_in.title,
        draft_description=shop_page_in.description,
    )
    db.add(shop_page)
    return _save(db, shop_page)


@router.patch("/merchants/me/shoppage", response_model=ShopPageOwnerResponse)
def update_my_shoppage(
    shop_page_update: ShopPageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Change the draft. Buyers see the change only after publish."""
    _, shop_page = _my_shop_page(db, current_user, editable=True)

    updates = shop_page_update.model_dump(exclude_unset=True)
    if "slug" in updates:
        existing = (
            db.query(ShopPage)
            .filter(ShopPage.slug == updates["slug"], ShopPage.id != shop_page.id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Slug already taken")

    if "title" in updates and not (updates["title"] or "").strip():
        raise HTTPException(status_code=422, detail="Title is required")

    upload_validation.check_image_url_fields(
        updates,
        {
            "banner_image_url": shop_page.draft_banner_image_url,
            "logo_url": shop_page.draft_logo_url,
        },
    )
    for field in ("banner_image_url", "logo_url"):
        if field in updates:
            updates[field] = upload_validation.blank_to_none(updates[field])

    # The slug is not part of the draft. It only names the page, and changes
    # at once: the old one is kept so /farms/<old> links redirect.
    if "slug" in updates:
        new_slug = updates.pop("slug")
        if new_slug is not None and new_slug != shop_page.slug:
            _claim_slug(db, new_slug)
            db.add(
                ShopSlugHistory(slug=shop_page.slug, merchant_id=shop_page.merchant_id)
            )
            shop_page.slug = new_slug
    for field, value in updates.items():
        setattr(shop_page, f"draft_{field}", value)

    return _save(db, shop_page)


@router.post("/merchants/me/shoppage/publish", response_model=ShopPageOwnerResponse)
def publish_my_shoppage(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Copy the draft to the live page. The first publish makes the shop public.

    Only a verified merchant may publish (403 otherwise). Approval never
    publishes by itself: prices and stock may be stale by then."""
    merchant, shop_page = _my_shop_page(db, current_user, editable=True)
    require_can_sell(merchant, PUBLISH_NOT_VERIFIED_DETAIL)
    if not (shop_page.draft_title or "").strip():
        raise HTTPException(status_code=422, detail="Add a title before you publish")
    for field in DRAFT_FIELDS:
        setattr(shop_page, field, getattr(shop_page, f"draft_{field}"))
    shop_page.published_at = datetime.now(UTC)
    return _save(db, shop_page)


@router.post("/merchants/me/shoppage/unpublish", response_model=ShopPageOwnerResponse)
def unpublish_my_shoppage(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hide the shop from buyers. The draft stays. Open orders continue.

    Publish makes the shop public again.
    """
    _, shop_page = _my_shop_page(db, current_user, editable=True)
    if not shop_page.is_published:
        raise HTTPException(status_code=400, detail="The shop is not live.")
    shop_page.published_at = None
    return _save(db, shop_page)


@router.post("/merchants/me/shoppage/discard", response_model=ShopPageOwnerResponse)
def discard_my_shoppage_draft(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Copy the live page back to the draft."""
    _, shop_page = _my_shop_page(db, current_user, editable=True)
    if not shop_page.is_published:
        raise HTTPException(
            status_code=400, detail="The shop is not live yet. Nothing to go back to."
        )
    for field in DRAFT_FIELDS:
        setattr(shop_page, f"draft_{field}", getattr(shop_page, field))
    return _save(db, shop_page)


def _upload_draft_image(
    db: Session,
    user: User,
    file: UploadFile,
    *,
    label: str,
    field: str,
    send: Callable[[int, upload_validation.CheckedFile], str],
) -> ShopPage:
    rate_limit.enforce_action(db, "image_upload", str(user.id))  # CF-0060
    merchant, shop_page = _my_shop_page(db, user, editable=True)
    checked = upload_validation.check_image_upload(file, label)
    try:
        url = send(merchant.id, checked)
    except Exception as exc:
        raise upstream_error(
            502, "Image upload failed", log="R2 image upload failed", exc=exc
        ) from exc
    # Each upload gets a new R2 key, so the live image does not change.
    setattr(shop_page, f"draft_{field}", url)
    return _save(db, shop_page)


@router.post("/merchants/me/shoppage/logo", response_model=ShopPageOwnerResponse)
def upload_my_shoppage_logo(
    logo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _upload_draft_image(
        db,
        current_user,
        logo,
        label="Logo",
        field="logo_url",
        send=r2_service.upload_shop_logo,
    )


@router.post("/merchants/me/shoppage/banner", response_model=ShopPageOwnerResponse)
def upload_my_shoppage_banner(
    banner: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _upload_draft_image(
        db,
        current_user,
        banner,
        label="Banner",
        field="banner_image_url",
        send=r2_service.upload_banner,
    )
