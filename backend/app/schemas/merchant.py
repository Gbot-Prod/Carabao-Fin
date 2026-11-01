from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.produce import ProduceResponse


class MerchantUpdate(BaseModel):
    merchant_name: str | None = None
    contact_email: EmailStr | None = None
    contact_number: str | None = None
    region: str | None = None
    province: str | None = None
    city: str | None = None
    barangay: str | None = None
    address: str | None = None
    postal_code: str | None = None
    operating_hours: Any | None = None
    delivery_price: int | None = None
    delivery_time: int | None = None


class MerchantShopResponse(BaseModel):
    id: int
    title: str
    slug: str
    banner_image_url: str | None = None
    description: str | None = None

    model_config = ConfigDict(from_attributes=True)


class MerchantResponse(BaseModel):
    id: int
    user_id: int
    merchant_name: str
    legal_business_name: str | None = None
    contact_email: EmailStr | None = None
    contact_number: str | None = None

    region: str
    province: str
    city: str | None = None
    barangay: str | None = None
    address: str
    postal_code: str

    available_days: list[str]
    operating_hours: Any
    delivery_price: int | None = None
    delivery_time: int | None = None
    price_range_min: int
    price_range_max: int
    rating: float | None = None
    deleted_at: datetime | None = None

    shop_page: MerchantShopResponse | None = None
    produces: list[ProduceResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
