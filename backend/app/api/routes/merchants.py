from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.produce import Produce
from app.models.shopPage import ShopPage
from app.models.user import User
from app.schemas.merchant import MerchantBase, MerchantPageBase, MerchantResponse, MerchantUpdate
from app.schemas.merchant_performance import MerchantPerformanceResponse
from app.schemas.produce import ProduceCreate, ProduceResponse, ProduceUpdate
from app.schemas.shopPage import ShopPageCreate, ShopPageResponse, ShopPageUpdate
from app.services.merchant_service import create_merchant
from app.services import r2_service

router = APIRouter()


@router.post("/merchants/me", response_model=MerchantResponse)
async def create_my_merchant_route(
    merchant: MerchantBase,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    payload = MerchantPageBase(user_id=current_user.id, **merchant.model_dump())
    try:
        return create_merchant(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/merchants", response_model=list[MerchantResponse])
async def list_merchants(db: Session = Depends(get_db)):
    return db.query(Merchant).order_by(Merchant.id.asc()).all()


@router.get("/merchants/{merchant_id}", response_model=MerchantResponse)
async def get_merchant(merchant_id: int, db: Session = Depends(get_db)):
    merchant = db.query(Merchant).filter(Merchant.id == merchant_id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return merchant


@router.patch("/merchants/me", response_model=MerchantResponse)
async def update_my_merchant(
    merchant_update: MerchantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    updates = merchant_update.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(merchant, field, value)

    db.commit()
    db.refresh(merchant)
    return merchant


@router.get("/merchants/me/performance", response_model=MerchantPerformanceResponse)
async def get_my_merchant_performance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    active_statuses = {"pending", "processing", "shipped", "out_for_delivery"}
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=30)

    total_products = (
        db.query(func.count(Produce.id)).filter(Produce.merchant_id == merchant.id).scalar() or 0
    )

    total_orders = (
        db.query(func.count(Order.id)).filter(Order.merchant_id == merchant.id).scalar() or 0
    )
    active_orders = (
        db.query(func.count(Order.id))
        .filter(Order.merchant_id == merchant.id, Order.status.in_(active_statuses))
        .scalar()
        or 0
    )
    delivered_orders = (
        db.query(func.count(Order.id))
        .filter(Order.merchant_id == merchant.id, Order.status == "delivered")
        .scalar()
        or 0
    )
    cancelled_orders = (
        db.query(func.count(Order.id))
        .filter(Order.merchant_id == merchant.id, Order.status == "cancelled")
        .scalar()
        or 0
    )

    total_revenue = (
        db.query(func.coalesce(func.sum(Order.total_price), 0))
        .filter(Order.merchant_id == merchant.id, Order.status != "cancelled")
        .scalar()
        or 0
    )
    last_order_at = (
        db.query(func.max(Order.ordered_at)).filter(Order.merchant_id == merchant.id).scalar()
    )

    last_30_days_orders = (
        db.query(func.count(Order.id))
        .filter(Order.merchant_id == merchant.id, Order.ordered_at >= window_start)
        .scalar()
        or 0
    )
    last_30_days_revenue = (
        db.query(func.coalesce(func.sum(Order.total_price), 0))
        .filter(
            Order.merchant_id == merchant.id,
            Order.ordered_at >= window_start,
            Order.status != "cancelled",
        )
        .scalar()
        or 0
    )

    return MerchantPerformanceResponse(
        merchant_id=merchant.id,
        merchant_name=merchant.merchant_name,
        rating=merchant.rating,
        total_products=int(total_products),
        total_orders=int(total_orders),
        active_orders=int(active_orders),
        delivered_orders=int(delivered_orders),
        cancelled_orders=int(cancelled_orders),
        total_revenue=int(total_revenue),
        last_order_at=last_order_at,
        last_30_days_orders=int(last_30_days_orders),
        last_30_days_revenue=int(last_30_days_revenue),
    )


# ---------------------------------------------------------------------------
# Produce routes
# ---------------------------------------------------------------------------


@router.get("/merchants/{merchant_id}/produce", response_model=list[ProduceResponse])
async def list_merchant_produce(merchant_id: int, db: Session = Depends(get_db)):
    merchant = db.query(Merchant).filter(Merchant.id == merchant_id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return merchant.produces


@router.post("/produce/", response_model=ProduceResponse)
async def create_produce(
    produce_in: ProduceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    produce = Produce(merchant_id=merchant.id, **produce_in.model_dump())
    db.add(produce)
    db.commit()
    db.refresh(produce)
    return produce


@router.patch("/produce/{produce_id}", response_model=ProduceResponse)
async def update_produce(
    produce_id: int,
    produce_update: ProduceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    produce = db.query(Produce).filter(Produce.id == produce_id, Produce.merchant_id == merchant.id).first()
    if not produce:
        raise HTTPException(status_code=404, detail="Produce item not found")

    for field, value in produce_update.model_dump(exclude_unset=True).items():
        setattr(produce, field, value)

    db.commit()
    db.refresh(produce)
    return produce


@router.delete("/produce/{produce_id}", status_code=204)
async def delete_produce(
    produce_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    produce = db.query(Produce).filter(Produce.id == produce_id, Produce.merchant_id == merchant.id).first()
    if not produce:
        raise HTTPException(status_code=404, detail="Produce item not found")

    db.delete(produce)
    db.commit()


# ---------------------------------------------------------------------------
# ShopPage routes
# ---------------------------------------------------------------------------


@router.get("/merchants/{merchant_id}/shoppage", response_model=ShopPageResponse)
async def get_merchant_shoppage(merchant_id: int, db: Session = Depends(get_db)):
    shop_page = db.query(ShopPage).filter(ShopPage.merchant_id == merchant_id).first()
    if not shop_page:
        raise HTTPException(status_code=404, detail="Shop page not found")
    return shop_page


@router.post("/merchants/me/shoppage", response_model=ShopPageResponse)
async def create_my_shoppage(
    shop_page_in: ShopPageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    if merchant.shop_page:
        raise HTTPException(status_code=400, detail="Shop page already exists — use PATCH to update")

    existing_slug = db.query(ShopPage).filter(ShopPage.slug == shop_page_in.slug).first()
    if existing_slug:
        raise HTTPException(status_code=400, detail="Slug already taken")

    shop_page = ShopPage(merchant_id=merchant.id, **shop_page_in.model_dump(exclude={"merchant_id"}))
    db.add(shop_page)
    db.commit()
    db.refresh(shop_page)
    return shop_page


@router.patch("/merchants/me/shoppage", response_model=ShopPageResponse)
async def update_my_shoppage(
    shop_page_update: ShopPageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(status_code=404, detail="Shop page not found — create one first with POST")

    updates = shop_page_update.model_dump(exclude_unset=True)
    if "slug" in updates:
        existing = db.query(ShopPage).filter(ShopPage.slug == updates["slug"], ShopPage.id != shop_page.id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Slug already taken")

    for field, value in updates.items():
        setattr(shop_page, field, value)

    db.commit()
    db.refresh(shop_page)
    return shop_page


@router.post("/merchants/me/shoppage/banner", response_model=ShopPageResponse)
async def upload_my_shoppage_banner(
    banner: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(status_code=404, detail="Shop page not found — create one first")

    if banner.content_type not in {"image/png", "image/jpeg", "image/jpg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Banner must be PNG, JPEG, or WebP")

    data = await banner.read()
    try:
        url = r2_service.upload_banner(merchant.id, data, banner.content_type or "image/jpeg", banner.filename or "")
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Image upload failed") from exc

    shop_page.banner_image_url = url
    db.commit()
    db.refresh(shop_page)
    return shop_page


@router.post("/produce/{produce_id}/image", response_model=ProduceResponse)
async def upload_produce_image(
    produce_id: int,
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    produce = db.query(Produce).filter(Produce.id == produce_id, Produce.merchant_id == merchant.id).first()
    if not produce:
        raise HTTPException(status_code=404, detail="Produce item not found")

    if image.content_type not in {"image/png", "image/jpeg", "image/jpg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Image must be PNG, JPEG, or WebP")

    data = await image.read()
    try:
        url = r2_service.upload_produce_image(merchant.id, produce_id, data, image.content_type or "image/jpeg", image.filename or "")
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Image upload failed") from exc

    produce.image_url = url
    db.commit()
    db.refresh(produce)
    return produce
