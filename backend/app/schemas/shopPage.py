from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

# CF-0043 (main) / CF-0051 (web loop): limits for the shop page, kept in step
# with the web Shop tab (maxLength in merchant/components/ShopTab.tsx). A slug
# is lowercase words joined by hyphens, e.g. "dela-cruz-farm", so it is safe in
# a URL and cannot imitate one. The web builds the slug from the title.
MAX_TITLE = 100
MAX_DESCRIPTION = 2000
SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
MIN_SLUG, MAX_SLUG = 3, 80


def _not_all_digits(slug: str | None) -> str | None:
    # /farms/<number> is a farm id, so a slug of only digits could never be
    # reached as /farms/<slug>. (A validator: the pattern engine has no lookahead.)
    if slug is not None and slug.isdigit():
        raise ValueError("The shop link needs at least one letter.")
    return slug


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

    _slug_has_letter = field_validator("slug")(_not_all_digits)


class ShopPageUpdate(BaseModel):
    """Changes to the draft. Buyers see them only after publish."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=MAX_TITLE)
    slug: str | None = Field(
        default=None, min_length=MIN_SLUG, max_length=MAX_SLUG, pattern=SLUG_PATTERN
    )
    # Only the stored URL or null (CF-0034, checked in the route).
    banner_image_url: str | None = None
    logo_url: str | None = None
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION)

    _slug_has_letter = field_validator("slug")(_not_all_digits)


class ShopSlugLookup(BaseModel):
    """GET /shops/{slug}: which farm a /farms/<slug> link names.

    ``slug`` is the shop's current one; when it differs from the slug asked
    for (an old one), the web page redirects to it.
    """

    merchant_id: int
    slug: str


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
