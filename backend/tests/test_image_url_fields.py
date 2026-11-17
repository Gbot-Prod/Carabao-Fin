"""CF-0034: image URLs are set by the upload routes, never by a JSON body."""

from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants
from app.core.errors import FieldErrors, field_errors_handler
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.shopPage import ShopPage
from app.models.user import User
from app.services.produce_freshness import ph_today

TODAY = ph_today()
STORED = "https://cdn.carabao.test/produce/1/abc.webp"
EVIL = "https://evil.example/pixel.gif"


def _farmer(db: Session, merchant: Merchant) -> TestClient:
    app = FastAPI()
    app.include_router(merchants.router)
    app.add_exception_handler(FieldErrors, field_errors_handler)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: db.get(User, merchant.user_id)
    return TestClient(app)


def _listing(**overrides: Any) -> dict[str, Any]:
    return {
        "name": "Tomato",
        "price": 50,
        "stock_quantity": 10,
        "harvest_date": TODAY.isoformat(),
        "best_before": (TODAY + timedelta(days=5)).isoformat(),
        **overrides,
    }


@pytest.fixture
def listing(db: Session, merchant: Merchant) -> Produce:
    produce = Produce(
        merchant_id=merchant.id,
        name="Tomato",
        price=50,
        stock_quantity=10,
        image_url=STORED,
        harvest_date=TODAY,
        best_before=TODAY + timedelta(days=5),
    )
    db.add(produce)
    db.commit()
    return produce


@pytest.fixture
def shop_page(db: Session, merchant: Merchant) -> ShopPage:
    page = ShopPage(
        merchant_id=merchant.id,
        title="Dela Cruz Farm",
        slug="dela-cruz",
        banner_image_url=STORED,
        logo_url=None,
    )
    db.add(page)
    db.commit()
    return page


@pytest.mark.parametrize("url", [EVIL, "javascript:alert(1)", "/relative.png"])
def test_create_listing_with_an_image_url_is_refused(
    db: Session, merchant: Merchant, url: str | None
) -> None:
    res = _farmer(db, merchant).post("/produce/", json=_listing(image_url=url))
    assert res.status_code == 400
    assert set(res.json()["errors"]) == {"image_url"}
    assert db.query(Produce).count() == 0


@pytest.mark.parametrize("url", [None, ""])
def test_create_listing_without_an_image_is_fine(
    db: Session, merchant: Merchant, url: str | None
) -> None:
    res = _farmer(db, merchant).post("/produce/", json=_listing(image_url=url))
    assert res.status_code == 200
    assert res.json()["image_url"] is None


def test_edit_cannot_point_the_photo_elsewhere(
    db: Session, merchant: Merchant, listing: Produce
) -> None:
    res = _farmer(db, merchant).patch(
        f"/produce/{listing.id}", json={"image_url": EVIL}
    )
    assert res.status_code == 400
    assert "uploading" in res.json()["errors"]["image_url"]
    db.refresh(listing)
    assert listing.image_url == STORED


def test_edit_form_sending_the_stored_photo_back_is_fine(
    db: Session, merchant: Merchant, listing: Produce
) -> None:
    """The web edit form posts every field, including the unchanged URL."""
    res = _farmer(db, merchant).patch(
        f"/produce/{listing.id}", json={"image_url": STORED, "price": 60}
    )
    assert res.status_code == 200
    assert res.json()["image_url"] == STORED
    assert res.json()["price"] == 60


@pytest.mark.parametrize("cleared", [None, ""])
def test_edit_can_remove_the_photo(
    db: Session, merchant: Merchant, listing: Produce, cleared: str | None
) -> None:
    res = _farmer(db, merchant).patch(
        f"/produce/{listing.id}", json={"image_url": cleared}
    )
    assert res.status_code == 200
    db.refresh(listing)
    assert listing.image_url is None


def test_shop_page_banner_and_logo_cannot_be_set_by_patch(
    db: Session, merchant: Merchant, shop_page: ShopPage
) -> None:
    res = _farmer(db, merchant).patch(
        "/merchants/me/shoppage",
        json={"banner_image_url": EVIL, "logo_url": EVIL, "title": "New"},
    )
    assert res.status_code == 400
    assert set(res.json()["errors"]) == {"banner_image_url", "logo_url"}
    db.refresh(shop_page)
    assert shop_page.banner_image_url == STORED
    assert shop_page.title == "Dela Cruz Farm"


def test_shop_page_patch_can_keep_or_clear_images(
    db: Session, merchant: Merchant, shop_page: ShopPage
) -> None:
    res = _farmer(db, merchant).patch(
        "/merchants/me/shoppage",
        json={"banner_image_url": STORED, "logo_url": "", "title": "New"},
    )
    assert res.status_code == 200
    db.refresh(shop_page)
    assert shop_page.banner_image_url == STORED
    assert shop_page.logo_url is None
    assert shop_page.title == "New"
