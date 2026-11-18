"""CF-0051 (B02): bounds and unknown-field refusal on merchant and buyer inputs.

``unit_quantity`` 0 or below broke per-unit math; names and descriptions had
no length limit; produce, shop page, review and shipment bodies took unknown
fields silently. All of these are now 422 before any route code runs.
"""

from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.produce import Produce
from app.schemas.produce import (
    DESCRIPTION_MAX_LENGTH,
    MAX_UNIT_QUANTITY,
    NAME_MAX_LENGTH,
    ProduceCreate,
    ProduceUpdate,
)
from app.schemas.review import ReviewCreate, ReviewUpdate
from app.schemas.shipment import CreateShipmentRequest
from app.schemas.shopPage import TITLE_MAX_LENGTH, ShopPageCreate, ShopPageUpdate
from tests.test_image_url_fields import _listing
from tests.test_produce_pricing import _farmer


@pytest.mark.parametrize(
    "overrides",
    [
        {"unit_quantity": 0},
        {"unit_quantity": -1.5},
        {"unit_quantity": MAX_UNIT_QUANTITY + 1},
        {"name": ""},
        {"name": "x" * (NAME_MAX_LENGTH + 1)},
        {"description": "x" * (DESCRIPTION_MAX_LENGTH + 1)},
        {"merchant_id": 999},
        {"hidden_at": "2026-01-01T00:00:00Z"},
    ],
)
def test_produce_create_refuses_bad_input(
    db: Session, merchant: Merchant, overrides: dict[str, Any]
) -> None:
    resp = _farmer(db, merchant).post("/produce/", json=_listing(**overrides))

    assert resp.status_code == 422, resp.text
    db.rollback()
    assert db.query(Produce).count() == 0


def test_produce_create_accepts_the_limits(db: Session, merchant: Merchant) -> None:
    body = _listing(
        name="x" * NAME_MAX_LENGTH,
        description="x" * DESCRIPTION_MAX_LENGTH,
        unit_quantity=0.25,
    )

    resp = _farmer(db, merchant).post("/produce/", json=body)

    assert resp.status_code == 200, resp.text
    assert resp.json()["unit_quantity"] == 0.25


@pytest.mark.parametrize(
    "body",
    [{"unit_quantity": 0}, {"name": ""}, {"merchant_id": 2}, {"rating": 5}],
)
def test_produce_update_refuses_bad_input(
    db: Session, merchant: Merchant, body: dict[str, Any]
) -> None:
    created = _farmer(db, merchant).post("/produce/", json=_listing()).json()

    resp = _farmer(db, merchant).patch(f"/produce/{created['id']}", json=body)

    assert resp.status_code == 422, resp.text
    db.expire_all()
    row = db.get(Produce, created["id"])
    assert row is not None and row.name == "Tomato" and row.unit_quantity == 1.0


def test_old_long_names_still_serialize(db: Session, merchant: Merchant) -> None:
    # A row saved before the limit must not break listing reads.
    db.add(
        Produce(
            merchant_id=merchant.id,
            name="x" * (NAME_MAX_LENGTH + 50),
            price=10,
            stock_quantity=1,
        )
    )
    db.commit()

    resp = _farmer(db, merchant).get("/merchants/me/produce")

    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize(
    "model, data",
    [
        (ShopPageCreate, {"title": "", "slug": "farm"}),
        (ShopPageCreate, {"title": "x" * (TITLE_MAX_LENGTH + 1), "slug": "farm"}),
        (ShopPageCreate, {"title": "Farm", "slug": ""}),
        (ShopPageCreate, {"title": "Farm", "slug": "Bad Slug!"}),
        (ShopPageCreate, {"title": "Farm", "slug": "farm", "merchant_id": 3}),
        (ShopPageUpdate, {"slug": "-farm-"}),
        (ShopPageUpdate, {"id": 1}),
        (ReviewCreate, {"rating": 5, "order_id": 9}),
        (ReviewUpdate, {"merchant_reply": "hi"}),
        (CreateShipmentRequest, {"order_ids": [1], "merchant_id": 2}),
    ],
)
def test_other_inputs_refuse_bad_or_unknown_fields(
    model: Any, data: dict[str, Any]
) -> None:
    with pytest.raises(ValidationError):
        model(**data)


def test_valid_other_inputs_still_pass() -> None:
    assert ShopPageCreate(title="Dela Cruz Farm", slug="dela-cruz-farm").slug
    assert ShopPageUpdate(slug="farm-2", description=None).slug == "farm-2"
    assert ReviewCreate(rating=4, comment="  Fresh  ").comment == "Fresh"
    assert CreateShipmentRequest(order_ids=[1, 2]).order_ids == [1, 2]
    assert ProduceUpdate(name="Talong", unit_quantity=2).unit_quantity == 2
    assert ProduceCreate(
        name="Talong", price=10, harvest_date="2026-11-18", best_before="2026-11-20"
    ).unit_quantity == 1.0
