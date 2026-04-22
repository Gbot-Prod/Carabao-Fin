from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.shopPage import ShopPage
from app.models.user import User
from app.schemas.merchant import MerchantBase, MerchantPageBase, MerchantResponse, MerchantUpdate
from app.schemas.produce import ProduceCreate, ProduceResponse, ProduceUpdate
from app.schemas.shopPage import ShopPageCreate, ShopPageResponse, ShopPageUpdate
from app.services.merchant_service import create_merchant

router = APIRouter()


@router.post("/merchant/", response_model=MerchantResponse)
async def create_merchant_route(merchant: MerchantPageBase, db: Session = Depends(get_db)):
    try:
        return create_merchant(db, merchant)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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

