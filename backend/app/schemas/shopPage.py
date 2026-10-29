from pydantic import BaseModel, ConfigDict


class ShopPageBase(BaseModel):
    title: str
    slug: str
    banner_image_url: str | None = None
    logo_url: str | None = None
    description: str | None = None


class ShopPageCreate(BaseModel):
    title: str
    slug: str
    description: str | None = None


class ShopPageUpdate(BaseModel):
    title: str | None = None
    slug: str | None = None
    banner_image_url: str | None = None
    logo_url: str | None = None
    description: str | None = None


class ShopPageResponse(ShopPageBase):
    id: int
    merchant_id: int

    model_config = ConfigDict(from_attributes=True)
