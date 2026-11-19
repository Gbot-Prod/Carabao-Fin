"""CF-0042 / CF-0043 limits, CF-0053 tracking status, CF-0054 suspended shop."""

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.models.order import Order
from app.models.produce import Produce
from app.models.shipment import Shipment
from app.schemas.produce import ProduceCreate, ProduceUpdate
from app.schemas.shopPage import ShopPageCreate, ShopPageUpdate
from app.services import order_status
from tests.payout_codes import save_payout_info
from tests.test_merchant_listings import _client as _merchant_client
from tests.test_payouts import GCASH, _delivered_sale
from tests.test_tracking import FakeSession, _order, _track

TODAY = date.today()
LISTING = {
    "name": "Talong",
    "price": 50,
    "harvest_date": (TODAY - timedelta(days=1)).isoformat(),
    "best_before": (TODAY + timedelta(days=5)).isoformat(),
}

# CF-0042 ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        {"name": ""},
        {"name": "x" * 101},
        {"description": "x" * 2001},
        {"unit_quantity": 0},
        {"unit_quantity": -1},
        {"unit_quantity": 1001},
    ],
)
def test_produce_create_refuses_out_of_bounds(bad):
    with pytest.raises(ValidationError):
        ProduceCreate.model_validate({**LISTING, **bad})


def test_produce_update_refuses_unknown_fields_and_bad_sizes():
    with pytest.raises(ValidationError):
        ProduceUpdate.model_validate({"merchant_id": 99})
    with pytest.raises(ValidationError):
        ProduceUpdate.model_validate({"unit_quantity": 0})
    assert ProduceUpdate.model_validate({"unit_quantity": 0.5}).unit_quantity == 0.5


# CF-0043 ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "slug",
    ["ab", "Dela-Cruz", "dela cruz", "a/b/c", "farm--x", "-farm", "fárm", "x" * 81],
)
def test_shop_slug_must_be_lowercase_words(slug):
    with pytest.raises(ValidationError):
        ShopPageCreate.model_validate({"title": "Farm", "slug": slug})
    with pytest.raises(ValidationError):
        ShopPageUpdate.model_validate({"slug": slug})


def test_shop_page_limits():
    assert ShopPageCreate.model_validate(
        {"title": "Dela Cruz Farm", "slug": "dela-cruz-farm-2"}
    )
    with pytest.raises(ValidationError):
        ShopPageCreate.model_validate({"title": "x" * 101, "slug": "farm"})
    with pytest.raises(ValidationError):
        ShopPageUpdate.model_validate({"description": "x" * 2001})
    with pytest.raises(ValidationError):
        ShopPageUpdate.model_validate({"merchant_id": 1})


# CF-0053 ---------------------------------------------------------------------


def test_tracking_reports_the_order_status_not_the_shipment():
    route = [
        {"type": "pickup", "lat": 14.6, "lng": 121.0, "label": "Farm", "sequence": 0},
        {
            "type": "delivery",
            "order_id": 5,
            "lat": 14.61,
            "lng": 121.01,
            "label": "Stop 1",
            "sequence": 1,
        },
    ]
    shipment = SimpleNamespace(
        id=9, status="in_transit", route_waypoints=route, shipped_at=None
    )
    response = _track(
        FakeSession(_order(shipment_id=9, status="delivered"), shipment)
    )
    assert response.status == "delivered"


def test_shipment_completes_when_its_last_order_closes(db, merchant, buyer):
    shipment = Shipment(merchant_id=merchant.id, stop_count=2, route_waypoints=[])
    db.add(shipment)
    db.flush()
    orders = [
        Order(
            user_id=buyer[0].id,
            merchant_id=merchant.id,
            status="shipped",
            total_price=100,
            items=[],
            shipment_id=shipment.id,
            shipped_at=datetime.now(UTC),
        )
        for _ in range(2)
    ]
    db.add_all(orders)
    db.commit()

    order_status.mark_delivered(orders[0], "buyer")
    db.commit()
    db.refresh(shipment)
    assert shipment.status == "in_transit"

    order_status.mark_delivered(orders[1], "buyer")
    db.commit()
    db.refresh(shipment)
    assert shipment.status == "completed"


# CF-0054 ---------------------------------------------------------------------


@pytest.fixture
def suspended(db, merchant):
    merchant.suspended_at = datetime.now(UTC)
    db.commit()
    return merchant


def test_suspended_shop_cannot_change_listings_or_orders(db, suspended, buyer):
    client = _merchant_client(db, suspended.user_id)
    talong = Produce(merchant_id=suspended.id, name="Talong", price=50)
    order = Order(
        user_id=buyer[0].id,
        merchant_id=suspended.id,
        status="processing",
        total_price=100,
        items=[],
    )
    db.add_all([talong, order])
    db.commit()

    attempts = [
        client.post("/produce/", json=LISTING),
        client.patch(f"/produce/{talong.id}", json={"price": 60}),
        client.delete(f"/produce/{talong.id}"),
        client.patch("/merchants/me/shoppage", json={"title": "New"}),
        client.post("/merchants/me/shoppage/publish"),
        client.patch(
            f"/merchants/me/orders/{order.id}/status", json={"status": "shipped"}
        ),
    ]
    for res in attempts:
        assert res.status_code == 403, res.text
        assert "suspended" in res.json()["detail"]


def test_suspended_shop_can_still_read_and_request_payout(db, merchant, buyer):
    client = _merchant_client(db, merchant.user_id)
    assert save_payout_info(client, GCASH).status_code == 200
    _delivered_sale(db, merchant, buyer)
    merchant.suspended_at = datetime.now(UTC)
    db.commit()

    assert client.get("/merchants/me/produce").status_code == 200
    assert client.get("/merchants/me/orders").status_code == 200
    res = client.post("/merchants/me/payouts/request")
    assert res.status_code == 200, res.text
