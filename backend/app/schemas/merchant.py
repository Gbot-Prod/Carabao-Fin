from typing import List, Optional

from pydantic import BaseModel

from app.schemas.produce import ProduceResponse


class MerchantBase(BaseModel):
    merchant_name: str
    location: Optional[str] = None
    contact_number: str
    operating_hours: Optional[str] = None
    delivery_price: Optional[int] = None
    delivery_time: Optional[int] = None
    rating: Optional[int] = None


class MerchantCreate(MerchantBase):
    user_id: int


class MerchantUpdate(BaseModel):
    merchant_name: Optional[str] = None
    location: Optional[str] = None
    contact_number: Optional[str] = None
    operating_hours: Optional[str] = None
    delivery_price: Optional[int] = None
    delivery_time: Optional[int] = None
    rating: Optional[int] = None


class MerchantShopPageInfo(BaseModel):
    id: int
    title: str
    slug: str
    banner_image_url: Optional[str] = None
    description: Optional[str] = None

    class Config:
        from_attributes = True


class MerchantResponse(MerchantBase):
    id: int
    user_id: int
    shop_page: Optional[MerchantShopPageInfo] = None
    produces: List[ProduceResponse] = []

    class Config:
        from_attributes = True


# Backward-compatible alias used by existing routes/services.
class MerchantPageBase(MerchantCreate):
    pass

