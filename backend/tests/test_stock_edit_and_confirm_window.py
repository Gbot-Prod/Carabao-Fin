"""CF-0049: stock edits vs checkout. Auto-confirm counts from shipping."""

from datetime import UTC, date, datetime, timedelta

from app.models.order import Order
from app.models.produce import Produce
from app.services import order_status
from tests.test_checkout_integrity import ADDRESS
from tests.test_checkout_integrity import _client as _buyer_client
from tests.test_merchant_listings import _client as _merchant_client


def _produce(db, merchant, stock=10):
    row = Produce(
        merchant_id=merchant.id,
        name="Talong",
        price=50,
        stock_quantity=stock,
        harvest_date=date.today() - timedelta(days=1),
        best_before=date.today() + timedelta(days=5),
    )
    db.add(row)
    db.commit()
    return row


# CF-0049 ---------------------------------------------------------------------


def test_stock_edit_is_refused_when_stock_changed(db, merchant):
    talong = _produce(db, merchant, stock=10)
    client = _merchant_client(db, merchant.user_id)
    talong.stock_quantity = 7  # a checkout took 3 after the form loaded
    db.commit()

    res = client.patch(
        f"/produce/{talong.id}",
        json={"stock_quantity": 15, "expected_stock_quantity": 10},
    )

    assert res.status_code == 409
    assert "changed to 7" in res.json()["detail"]
    db.expire_all()
    assert db.get(Produce, talong.id).stock_quantity == 7


def test_stock_edit_applies_when_unchanged(db, merchant):
    talong = _produce(db, merchant, stock=10)
    res = _merchant_client(db, merchant.user_id).patch(
        f"/produce/{talong.id}",
        json={"stock_quantity": 15, "expected_stock_quantity": 10},
    )
    assert res.status_code == 200, res.text
    assert res.json()["stock_quantity"] == 15


def test_stock_edit_without_expected_value_still_works(db, merchant):
    """Older clients (mobile) do not send the expected value yet."""
    talong = _produce(db, merchant, stock=10)
    res = _merchant_client(db, merchant.user_id).patch(
        f"/produce/{talong.id}", json={"stock_quantity": 4}
    )
    assert res.status_code == 200
    assert res.json()["stock_quantity"] == 4


# Auto-confirm window ---------------------------------------------------------


def _shipped(db, merchant, buyer, shipped_days_ago):
    order = Order(
        user_id=buyer[0].id,
        merchant_id=merchant.id,
        status="shipped",
        total_price=100,
        items=[],
        shipped_at=datetime.now(UTC) - timedelta(days=shipped_days_ago),
    )
    db.add(order)
    db.commit()
    return order


def test_auto_confirm_counts_from_shipping(db, merchant, buyer):
    recent = _shipped(db, merchant, buyer, 3)
    old = _shipped(db, merchant, buyer, 8)

    assert order_status.cancel_unshipped_orders(db, 5) == 0
    assert order_status.auto_confirm_delivered_orders(db, 7) == 1
    db.commit()

    assert recent.status == "shipped"
    assert old.status == "delivered"


def test_buyer_cannot_send_a_delivery_date(db, merchant, buyer):
    """The farm decides when to deliver; checkout takes no date or window."""
    talong = _produce(db, merchant)
    client = _buyer_client(db, buyer[0])
    client.put("/carts/me", json={"items": [{"produce_id": talong.id, "quantity": 1}]})

    res = client.post(
        "/orders/me/place", json={**ADDRESS, "delivery_date": date.today().isoformat()}
    )

    assert res.status_code == 422
