from pydantic import BaseModel, ConfigDict, Field

# CF-0051 (B02): input limits, kept in step with the web Shop tab (maxLength in
# merchant/components/ShopTab.tsx). The web builds the slug from the title.
TITLE_MAX_LENGTH = 100
DESCRIPTION_MAX_LENGTH = 2000
SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class ShopPageBase(BaseModel):
    title: str
    slug: str
    banner_image_url: str | None = None
    logo_url: str | None = None
    description: str | None = None


class ShopPageCreate(BaseModel):
    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    slug: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH, pattern=SLUG_PATTERN)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH)

    model_config = ConfigDict(extra="forbid")


class ShopPageUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=TITLE_MAX_LENGTH)
    slug: str | None = Field(
        default=None, min_length=1, max_length=TITLE_MAX_LENGTH, pattern=SLUG_PATTERN
    )
    # Only the stored URL or null (CF-0034, checked in the route).
    banner_image_url: str | None = None
    logo_url: str | None = None
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH)

    model_config = ConfigDict(extra="forbid")


class ShopPageResponse(ShopPageBase):
    id: int
    merchant_id: int

    model_config = ConfigDict(from_attributes=True)
