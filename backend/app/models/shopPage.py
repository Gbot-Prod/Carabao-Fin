from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base

# Fields a merchant edits as a draft. publish copies each draft_<name> to <name>.
DRAFT_FIELDS = ("title", "description", "logo_url", "banner_image_url")


class ShopPage(Base):
    """The public shop page, plus the merchant's unpublished draft of it.

    Buyers only see the live columns (title, description, logo_url,
    banner_image_url), and only after the first publish (published_at set).
    The merchant edits the draft_* columns; publish copies them to the live
    columns. A merchant is not public until its shop page is published.
    """

    __tablename__ = "shop_pages"

    id = Column(Integer, primary_key=True, index=True)
    merchant_id = Column(
        Integer, ForeignKey("merchants.id"), nullable=False, unique=True, index=True
    )
    # Live (published) values.
    title = Column(String, nullable=False, index=True)
    slug = Column(String, nullable=False, unique=True, index=True)
    banner_image_url = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    description = Column(Text, nullable=True)

    # Draft values. Only the owner sees them.
    draft_title = Column(
        String,
        nullable=False,
        default=lambda ctx: ctx.get_current_parameters()["title"],
    )
    draft_description = Column(Text, nullable=True)
    draft_logo_url = Column(String, nullable=True)
    draft_banner_image_url = Column(String, nullable=True)

    # Time of the last publish. NULL: the shop was never published.
    published_at = Column(DateTime(timezone=True), nullable=True, index=True)

    merchant = relationship("Merchant", back_populates="shop_page")

    @property
    def is_published(self) -> bool:
        return self.published_at is not None

    @property
    def has_unpublished_changes(self) -> bool:
        if self.published_at is None:
            return True
        return any(
            getattr(self, f"draft_{field}") != getattr(self, field)
            for field in DRAFT_FIELDS
        )


class ShopSlugHistory(Base):
    """A slug a shop used before (/farms/<slug> links shared or indexed then).

    The web page redirects an old slug to the shop's current one, so a rename
    keeps old links and search ranking. A current slug always wins: when a
    shop takes a slug, any history row holding it is removed (it now names
    that shop).
    """

    __tablename__ = "shop_slug_history"

    id = Column(Integer, primary_key=True)
    slug = Column(String, nullable=False, unique=True, index=True)
    merchant_id = Column(
        Integer,
        ForeignKey("merchants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
