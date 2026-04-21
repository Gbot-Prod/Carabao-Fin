from typing import Optional

from pydantic import BaseModel


class ShopPageBase(BaseModel):
    title: str
    slug: str
    banner_image_url: Optional[str] = None
    description: Optional[str] = None


class ShopPageCreate(ShopPageBase):
    merchant_id: int


class ShopPageUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    banner_image_url: Optional[str] = None
    description: Optional[str] = None


class ShopPageResponse(ShopPageBase):
    id: int
    merchant_id: int

    class Config:
        from_attributes = True