from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.current_orders import CurrentOrder
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.payout_batch import PayoutBatch, PayoutBatchItem
from app.models.produce import Produce
from app.models.shopPage import ShopPage
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.merchant import MerchantBase, MerchantPageBase, MerchantResponse, MerchantUpdate
from app.schemas.merchant_performance import MerchantPerformanceResponse
from app.schemas.payout import PayoutBatchResponse, PayoutInfoResponse, PayoutInfoUpdate, TransactionSummary
from app.schemas.produce import ProduceCreate, ProduceResponse, ProduceUpdate
from app.schemas.shopPage import ShopPageCreate, ShopPageResponse, ShopPageUpdate
from app.services.merchant_service import create_merchant
from app.services import r2_service

router = APIRouter(tags=["merchants"])


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
    return (
        db.query(Merchant)
        .outerjoin(MerchantApplication, MerchantApplication.user_id == Merchant.user_id)
        .filter(
            or_(
                MerchantApplication.id.is_(None),
                MerchantApplication.status != "rejected",
            )
        )
        .order_by(Merchant.id.asc())
        .all()
    )


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

    shop_page = ShopPage(merchant_id=merchant.id, **shop_page_in.model_dump())
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


@router.post("/merchants/me/shoppage/logo", response_model=ShopPageResponse)
async def upload_my_shoppage_logo(
    logo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    shop_page = merchant.shop_page
    if not shop_page:
        raise HTTPException(status_code=404, detail="Shop page not found — create one first")

    if logo.content_type not in {"image/png", "image/jpeg", "image/jpg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Logo must be PNG, JPEG, or WebP")

    data = await logo.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Logo must be under 5 MB")
    try:
        url = r2_service.upload_shop_logo(merchant.id, data, logo.content_type or "image/jpeg", logo.filename or "")
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Image upload failed") from exc

    shop_page.logo_url = url
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
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Banner must be under 5 MB")
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
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be under 5 MB")
    try:
        url = r2_service.upload_produce_image(merchant.id, produce_id, data, image.content_type or "image/jpeg", image.filename or "")
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Image upload failed") from exc

    produce.image_url = url
    db.commit()
    db.refresh(produce)
    return produce


# ---------------------------------------------------------------------------
# Payout routes (merchant-facing)
# ---------------------------------------------------------------------------


@router.get("/merchants/me/payout-info", response_model=Optional[PayoutInfoResponse])
async def get_my_payout_info(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return db.query(MerchantPayoutInfo).filter(MerchantPayoutInfo.merchant_id == merchant.id).first()


@router.put("/merchants/me/payout-info", response_model=PayoutInfoResponse)
async def update_my_payout_info(
    payload: PayoutInfoUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    info = db.query(MerchantPayoutInfo).filter(MerchantPayoutInfo.merchant_id == merchant.id).first()
    if not info:
        info = MerchantPayoutInfo(merchant_id=merchant.id, **payload.model_dump())
        db.add(info)
    else:
        for field, value in payload.model_dump().items():
            setattr(info, field, value)

    db.commit()
    db.refresh(info)
    return info


@router.get("/merchants/me/payouts", response_model=list[PayoutBatchResponse])
async def get_my_payouts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return (
        db.query(PayoutBatch)
        .filter(PayoutBatch.merchant_id == merchant.id)
        .order_by(PayoutBatch.created_at.desc())
        .all()
    )


@router.get("/merchants/me/transactions", response_model=list[TransactionSummary])
async def get_my_transactions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return (
        db.query(Transaction)
        .filter(Transaction.merchant_id == merchant.id)
        .order_by(Transaction.created_at.desc())
        .limit(50)
        .all()
    )


@router.post("/merchants/me/payouts/request", response_model=PayoutBatchResponse)
async def request_my_payout(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    payout_info = db.query(MerchantPayoutInfo).filter(MerchantPayoutInfo.merchant_id == merchant.id).first()
    if not payout_info:
        raise HTTPException(status_code=400, detail="Set up your payout method before requesting a cash out")

    pending = (
        db.query(PayoutBatch)
        .filter(
            PayoutBatch.merchant_id == merchant.id,
            PayoutBatch.status.in_(["pending", "approved", "processing"]),
        )
        .first()
    )
    if pending:
        raise HTTPException(status_code=400, detail="You already have a pending payout request")

    already_batched_ids = (
        db.query(PayoutBatchItem.transaction_id)
        .join(PayoutBatch, PayoutBatch.id == PayoutBatchItem.batch_id)
        .filter(PayoutBatch.status.in_(["released", "approved", "processing", "pending"]))
        .scalar_subquery()
    )

    unpaid_txns = (
        db.query(Transaction)
        .filter(
            Transaction.merchant_id == merchant.id,
            Transaction.status == "paid",
            Transaction.id.not_in(already_batched_ids),
        )
        .all()
    )

    if not unpaid_txns:
        raise HTTPException(status_code=400, detail="No unpaid earnings to cash out")

    total = sum(t.merchant_amount for t in unpaid_txns)
    batch = PayoutBatch(
        merchant_id=merchant.id,
        period_date=datetime.now(timezone.utc).date(),
        transaction_count=len(unpaid_txns),
        gross_amount=total,
        status="pending",
    )
    db.add(batch)
    db.flush()

    for txn in unpaid_txns:
        db.add(PayoutBatchItem(batch_id=batch.id, transaction_id=txn.id, amount=txn.merchant_amount))

    db.commit()
    db.refresh(batch)
    return batch


@router.delete("/merchants/me", status_code=204)
async def delete_my_merchant(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    # Null out nullable merchant_id references on order records (preserves order history)
    db.query(Order).filter(Order.merchant_id == merchant.id).update(
        {"merchant_id": None}, synchronize_session=False
    )
    db.query(CurrentOrder).filter(CurrentOrder.merchant_id == merchant.id).update(
        {"merchant_id": None}, synchronize_session=False
    )

    # Remove payout batch items before batches (FK: payout_batch_items.batch_id)
    batch_ids = [
        row.id for row in
        db.query(PayoutBatch.id).filter(PayoutBatch.merchant_id == merchant.id).all()
    ]
    if batch_ids:
        db.query(PayoutBatchItem).filter(PayoutBatchItem.batch_id.in_(batch_ids)).delete(synchronize_session=False)
        db.query(PayoutBatch).filter(PayoutBatch.merchant_id == merchant.id).delete(synchronize_session=False)

    # Remove transactions (merchant_id is non-nullable, cannot be orphaned)
    db.query(Transaction).filter(Transaction.merchant_id == merchant.id).delete(synchronize_session=False)

    # Remove payout configuration
    db.query(MerchantPayoutInfo).filter(MerchantPayoutInfo.merchant_id == merchant.id).delete(synchronize_session=False)

    db.delete(merchant)
    db.commit()
