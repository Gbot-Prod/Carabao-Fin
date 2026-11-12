"""A1: admin order list (filters) and detail view."""

from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin_orders
from app.models.order import Order
from app.models.shipment import Shipment
from app.models.transaction import Transaction
from app.models.user import User
from tests.test_merchant_listings import _other_merchant
from tests.test_reviews import _buyer, db, merchant  # noqa: F401 - fixtures


def _client(db, user) -> TestClient:
    app = FastAPI()
    app.include_router(admin_orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _admin(db) -> User:
    admin = User(email="admin@example.com", is_admin=True)
    db.add(admin)
    db.commit()
    return admin


def _order(
    db, merchant, buyer, status="processing", ordered_at=None, items=None, **extra
):
    user, history = buyer
    order = Order(
        order_history_id=history.id,
        user_id=user.id,
        merchant_id=merchant.id,
        status=status,
        total_price=500,
        items=(
            items
            if items is not None
            else [{"produce_id": 1, "name": "Talong", "quantity": 2, "price": 250}]
        ),
        ordered_at=ordered_at or datetime(2026, 11, 10, 9, tzinfo=UTC),
        **extra,
    )
    db.add(order)
    db.commit()
    return order


def _txn(db, order, status):
    txn = Transaction(
        order_id=order.id,
        merchant_id=order.merchant_id,
        user_id=order.user_id,
        amount=order.total_price,
        platform_fee=10,
        merchant_amount=order.total_price - 10,
        status=status,
    )
    db.add(txn)
    db.commit()
    return txn


def _ids(res):
    assert res.status_code == 200, res.text
    return sorted(o["id"] for o in res.json()["items"])


def test_non_admin_is_forbidden(db, merchant):
    buyer = _buyer(db)
    client = _client(db, buyer[0])
    assert client.get("/admin/orders").status_code == 403
    assert client.get("/admin/orders/1").status_code == 403


def test_lists_every_order_newest_first(db, merchant):
    buyer = _buyer(db)
    other = _other_merchant(db)
    a = _order(db, merchant, buyer, ordered_at=datetime(2026, 11, 1, tzinfo=UTC))
    b = _order(db, other, buyer, ordered_at=datetime(2026, 11, 5, tzinfo=UTC))
    res = _client(db, _admin(db)).get("/admin/orders")
    body = res.json()
    assert body["total"] == 2
    assert [o["id"] for o in body["items"]] == [b.id, a.id]
    assert body["items"][0]["merchant_name"] == "Other Farm"
    assert body["items"][0]["buyer_name"] == "Juan dela Cruz"


def test_filters_by_status_merchant_and_date(db, merchant):
    buyer = _buyer(db)
    other = _other_merchant(db)
    a = _order(db, merchant, buyer, "shipped", datetime(2026, 11, 1, tzinfo=UTC))
    b = _order(db, merchant, buyer, "delivered", datetime(2026, 11, 7, 23, tzinfo=UTC))
    c = _order(db, other, buyer, "shipped", datetime(2026, 11, 9, tzinfo=UTC))
    client = _client(db, _admin(db))

    assert _ids(client.get("/admin/orders?status=shipped")) == [a.id, c.id]
    assert _ids(client.get(f"/admin/orders?merchant_id={other.id}")) == [c.id]
    # date_to is inclusive of the whole day.
    got = _ids(client.get("/admin/orders?date_from=2026-11-02&date_to=2026-11-07"))
    assert got == [b.id]
    assert client.get("/admin/orders?status=bogus").status_code == 422


def test_filters_by_payment_status(db, merchant):
    buyer = _buyer(db)
    awaiting = _order(db, merchant, buyer, "pending")
    paid = _order(db, merchant, buyer)
    _txn(db, paid, "paid")
    # A paid order with an extra refunded charge still reads as paid.
    _txn(db, paid, "refunded")
    pending_refund = _order(db, merchant, buyer, "cancelled")
    _txn(db, pending_refund, "refund_pending")
    unpaid = _order(db, merchant, buyer, "cancelled")
    _txn(db, unpaid, "expired")
    client = _client(db, _admin(db))

    def by(p):
        return _ids(client.get(f"/admin/orders?payment_status={p}"))

    assert by("paid") == [paid.id]
    assert by("refund_pending") == [pending_refund.id]
    assert by("refunded") == []
    assert by("awaiting_payment") == [awaiting.id]
    assert by("unpaid") == [unpaid.id]


def test_pagination(db, merchant):
    buyer = _buyer(db)
    for _ in range(3):
        _order(db, merchant, buyer)
    body = _client(db, _admin(db)).get("/admin/orders?page=2&page_size=2").json()
    assert body["total"] == 3 and len(body["items"]) == 1 and body["page"] == 2


def test_detail_shows_items_transaction_shipment_and_delivery(db, merchant):
    buyer = _buyer(db)
    shipment = Shipment(merchant_id=merchant.id, status="delivered", stop_count=3)
    db.add(shipment)
    db.commit()
    delivered = datetime(2026, 11, 11, 15, tzinfo=UTC)
    order = _order(
        db,
        merchant,
        buyer,
        "delivered",
        shipment_id=shipment.id,
        delivery_address="Purok 3, Malolos",
        delivered_at=delivered,
        delivery_confirmed_by="buyer",
    )
    _txn(db, order, "paid")

    res = _client(db, _admin(db)).get(f"/admin/orders/{order.id}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["payment_status"] == "paid"
    assert body["items"][0]["name"] == "Talong"
    assert [t["status"] for t in body["transactions"]] == ["paid"]
    assert body["shipment"] == {
        "id": shipment.id,
        "status": "delivered",
        "stop_count": 3,
        "shipped_at": body["shipment"]["shipped_at"],
    }
    assert body["delivery"]["delivery_confirmed_by"] == "buyer"
    assert body["delivery"]["delivery_address"] == "Purok 3, Malolos"
    assert body["delivery"]["delivered_at"] is not None


def test_detail_unknown_order_is_404(db, merchant):
    assert _client(db, _admin(db)).get("/admin/orders/999").status_code == 404
