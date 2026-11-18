"""Find stored image URLs that don't point at our R2 bucket (CF-0057, B31).

Since CF-0034 only the upload routes set image URLs, but rows saved before
that (or written by hand) may point anywhere: a tracking pixel, a dead link,
someone else's site. This is a report only; nothing is changed or deleted.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.models.order import Order
from app.models.produce import Produce
from app.models.shopPage import ShopPage
from app.models.user import User


@dataclass(frozen=True)
class OffsiteImage:
    table: str
    row_id: int
    column: str
    url: str


# (model, table name, URL columns) checked.
_TARGETS: tuple[tuple[Any, str, tuple[str, ...]], ...] = (
    (Produce, "produces", ("image_url",)),
    (ShopPage, "shop_pages", ("banner_image_url", "logo_url")),
    (User, "backend_users", ("profile_picture_url",)),
    (Order, "orders", ("image",)),  # snapshot of the first listing photo
)


def is_own_url(url: str, public_url: str) -> bool:
    """True when ``url`` is under the bucket's public URL (path boundary checked,
    so ``https://cdn.example`` does not match ``https://cdn.example.evil``)."""
    base = public_url.rstrip("/")
    return bool(base) and (url == base or url.startswith(base + "/"))


def find_offsite_images(db: Session, public_url: str) -> list[OffsiteImage]:
    """Every non-empty image URL not under ``public_url``, ordered by table, id."""
    if not public_url.strip():
        raise ValueError("CLOUDFLARE_R2_PUBLIC_URL is not set; nothing to compare with")
    found: list[OffsiteImage] = []
    for model, table, columns in _TARGETS:
        for column in columns:
            col = getattr(model, column)
            rows = (
                db.query(model.id, col)
                .filter(col.isnot(None), col != "")
                .order_by(model.id)
                .all()
            )
            found.extend(
                OffsiteImage(table, row_id, column, url)
                for row_id, url in rows
                if not is_own_url(url, public_url)
            )
    return found
