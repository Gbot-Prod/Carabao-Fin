"""A farm's public shop page: read, create, edit, logo and banner (CF-0079: moved
from routes/merchants.py without a change in behaviour)."""

import logging

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
)
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.errors import upstream_error
from app.models.merchant import Merchant
from app.models.shopPage import ShopPage
from app.models.user import User
from app.schemas.shopPage import ShopPageCreate, ShopPageResponse, ShopPageUpdate
from app.services import (
    r2_service,
    rate_limit,
    upload_validation,
)
from app.services.account_suspension import merchant_is_public
from app.services.merchant_service import (
    get_active_merchant,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["merchants"])


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


@router.post("/merchants/me/shoppage", response_model=ShopPageResponse)
def create_my_shoppage(
    shop_page_in: ShopPageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
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

    shop_page = ShopPage(merchant_id=merchant.id, **shop_page_in.model_dump())
    db.add(shop_page)
    db.commit()
    db.refresh(shop_page)
    return shop_page


@router.patch("/merchants/me/shoppage", response_model=ShopPageResponse)
def update_my_shoppage(
    shop_page_update: ShopPageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(
            status_code=404, detail="Shop page not found — create one first with POST"
        )

    updates = shop_page_update.model_dump(exclude_unset=True)
    if "slug" in updates:
        existing = (
            db.query(ShopPage)
            .filter(ShopPage.slug == updates["slug"], ShopPage.id != shop_page.id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Slug already taken")

    upload_validation.check_image_url_fields(
        updates,
        {
            "banner_image_url": shop_page.banner_image_url,
            "logo_url": shop_page.logo_url,
        },
    )
    for field in ("banner_image_url", "logo_url"):
        if field in updates:
            updates[field] = upload_validation.blank_to_none(updates[field])
    for field, value in updates.items():
        setattr(shop_page, field, value)

    db.commit()
    db.refresh(shop_page)
    return shop_page


@router.post("/merchants/me/shoppage/logo", response_model=ShopPageResponse)
def upload_my_shoppage_logo(
    logo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "image_upload", str(current_user.id))  # CF-0060
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(
            status_code=404, detail="Shop page not found — create one first"
        )

    checked = upload_validation.check_image_upload(logo, "Logo")
    try:
        url = r2_service.upload_shop_logo(merchant.id, checked)
    except Exception as exc:
        raise upstream_error(
            502, "Image upload failed", log="R2 image upload failed", exc=exc
        ) from exc

    shop_page.logo_url = url
    db.commit()
    db.refresh(shop_page)
    return shop_page


@router.post("/merchants/me/shoppage/banner", response_model=ShopPageResponse)
def upload_my_shoppage_banner(
    banner: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "image_upload", str(current_user.id))  # CF-0060
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(
            status_code=404, detail="Shop page not found — create one first"
        )

    checked = upload_validation.check_image_upload(banner, "Banner")
    try:
        url = r2_service.upload_banner(merchant.id, checked)
    except Exception as exc:
        raise upstream_error(
            502, "Image upload failed", log="R2 image upload failed", exc=exc
        ) from exc

    shop_page.banner_image_url = url
    db.commit()
    db.refresh(shop_page)
    return shop_page
