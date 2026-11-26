"""CF-0070 (B10): hiding an order removes it from the buyer's history only."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.order import Order
from app.services import data_export
from tests.checkout_helpers import _client
from tests.test_admin_orders import _admin, _order
from tests.test_admin_orders import _client as _admin_client


def test_hidden_order_leaves_only_the_buyer_lists(
    db: Session, merchant: Any, buyer: Any
) -> None:
    user = buyer[0]
    hidden = _order(db, merchant, buyer, status="delivered")
    shown = _order(db, merchant, buyer, status="delivered")
    client = _client(db, user)

    assert client.delete(f"/orders/me/history/{hidden.id}").status_code == 204

    plain = [o["id"] for o in client.get("/orders/me/history").json()]
    paged = client.get("/orders/me/history/page").json()
    assert plain == [shown.id]
    assert [o["id"] for o in paged["items"]] == [shown.id] and paged["total"] == 1
    # A direct link (receipt, notification) still opens it.
    assert client.get(f"/orders/me/{hidden.id}").status_code == 200
    # Admins still see it, and so does the buyer's own data export.
    admin_ids = [
        o["id"]
        for o in _admin_client(db, _admin(db)).get("/admin/orders").json()["items"]
    ]
    assert hidden.id in admin_ids
    exported = [o["id"] for o in data_export.build_export(db, user)["orders"]]
    assert hidden.id in exported


def test_an_active_order_cannot_be_hidden(
    db: Session, merchant: Any, buyer: Any
) -> None:
    order = _order(db, merchant, buyer, status="processing")
    res = _client(db, buyer[0]).delete(f"/orders/me/history/{order.id}")
    assert res.status_code == 400
    db.expire_all()
    stored: Any = db.get(Order, order.id)
    assert stored.hidden_by_buyer_at is None


def test_another_buyers_order_is_404(db: Session, merchant: Any, buyer: Any) -> None:
    from tests.shared_fixtures import _buyer

    order = _order(db, merchant, buyer, status="delivered")
    stranger, _ = _buyer(db, "stranger@example.com")
    assert (
        _client(db, stranger).delete(f"/orders/me/history/{order.id}").status_code
        == 404
    )
    db.expire_all()
    stored: Any = db.get(Order, order.id)
    assert stored.hidden_by_buyer_at is None
