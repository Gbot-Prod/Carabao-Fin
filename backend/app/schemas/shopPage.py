from datetime import datetime

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
    """Changes to the draft. Buyers see them only after publish."""

    title: str | None = None
    slug: str | None = None
    banner_image_url: str | None = None
    logo_url: str | None = None
    description: str | None = None


class ShopPageResponse(ShopPageBase):
    """The live shop page, as buyers see it."""

    id: int
    merchant_id: int

    model_config = ConfigDict(from_attributes=True)


class ShopPageOwnerResponse(ShopPageResponse):
    """The live shop page plus the owner's draft and publish state."""

    draft_title: str
    draft_description: str | None = None
    draft_logo_url: str | None = None
    draft_banner_image_url: str | None = None
    published_at: datetime | None = None
    is_published: bool
    has_unpublished_changes: bool
