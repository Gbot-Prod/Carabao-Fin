from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# CF-0043: limits for the shop page. A slug is lowercase words joined by
# hyphens, e.g. "dela-cruz-farm", so it is safe in a URL and cannot imitate one.
MAX_TITLE = 100
MAX_DESCRIPTION = 2000
SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
MIN_SLUG, MAX_SLUG = 3, 80


class ShopPageBase(BaseModel):
    title: str
    slug: str
    banner_image_url: str | None = None
    logo_url: str | None = None
    description: str | None = None


class ShopPageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=MAX_TITLE)
    slug: str = Field(min_length=MIN_SLUG, max_length=MAX_SLUG, pattern=SLUG_PATTERN)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION)


class ShopPageUpdate(BaseModel):
    """Changes to the draft. Buyers see them only after publish."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=MAX_TITLE)
    slug: str | None = Field(
        default=None, min_length=MIN_SLUG, max_length=MAX_SLUG, pattern=SLUG_PATTERN
    )
    banner_image_url: str | None = None
    logo_url: str | None = None
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION)


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
