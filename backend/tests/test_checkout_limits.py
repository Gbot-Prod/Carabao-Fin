"""CF-0045 (B50): limits on placing orders and opening PayMongo checkouts.

Each placed order holds its stock for the reservation TTL and each checkout
call can open a PayMongo session. Without limits one account could keep a
farm's stock reserved by placing and abandoning orders, and spam PayMongo.
"""

from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders, payments
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.produce import Produce
from app.models.statuses import OrderStatus
from app.models.user import User
from app.services.order_reservations import MAX_OPEN_PENDING_ORDERS
from app.services.rate_limit import ACTION_LIMITS
from tests.shared_fixtures import _buyer
from tests.test_self_dealing import _cart, _produce


def _client(db: Session, user: User) -> TestClient:
    app = FastAPI()
    app.include_router(orders.router)
    app.include_router(payments.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _held_orders(
    db: Session,
    merchant: Merchant,
    user: User,
    count: int,
    status: str = OrderStatus.PENDING,
    ordered_at: datetime | None = None,
) -> None:
    for _ in range(count):
        db.add(
            Order(
                user_id=user.id,
                merchant_id=merchant.id,
                status=status,
                total_price=50,
                items=[{"produce_id": 1, "name": "Talong", "quantity": 1, "price": 50}],
                ordered_at=ordered_at or datetime.now(UTC),
            )
        )
    db.commit()


def _place(client: TestClient) -> int:
    return client.post("/orders/me/place", json={}).status_code


def test_buyer_at_the_pending_cap_cannot_place_and_nothing_moves(
    db: Session, merchant: Merchant
) -> None:
    user, _ = _buyer(db)
    _held_orders(db, merchant, user, MAX_OPEN_PENDING_ORDERS)
    item = _produce(db, merchant, "Mangga")
    _cart(db, user, item)
    user_id = user.id

    resp = _client(db, user).post("/orders/me/place", json={})

    assert resp.status_code == 409
    assert "unpaid orders" in resp.json()["detail"]
    db.rollback()
    assert db.query(Order).filter(Order.user_id == user_id).count() == (
        MAX_OPEN_PENDING_ORDERS
    )
    db.expire_all()
    assert db.get(Produce, item.id).stock_quantity == 10  # type: ignore[union-attr]


def test_buyer_under_the_cap_can_place(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db)
    _held_orders(db, merchant, user, MAX_OPEN_PENDING_ORDERS - 1)
    _cart(db, user, _produce(db, merchant, "Mangga"))

    resp = _client(db, user).post("/orders/me/place", json={})

    assert resp.status_code == 200, resp.text


def test_paid_cancelled_and_expired_orders_do_not_count(
    db: Session, merchant: Merchant
) -> None:
    user, _ = _buyer(db)
    _held_orders(db, merchant, user, 4, status=OrderStatus.PROCESSING)
    _held_orders(db, merchant, user, 4, status=OrderStatus.CANCELLED)
    # Older than the TTL: the sweep at the start of place releases them.
    _held_orders(
        db,
        merchant,
        user,
        MAX_OPEN_PENDING_ORDERS,
        ordered_at=datetime.now(UTC) - timedelta(hours=2),
    )
    _cart(db, user, _produce(db, merchant, "Mangga"))

    resp = _client(db, user).post("/orders/me/place", json={})

    assert resp.status_code == 200, resp.text


def test_the_cap_is_per_buyer(db: Session, merchant: Merchant) -> None:
    hoarder, _ = _buyer(db, "hoarder@example.com")
    other, _ = _buyer(db, "other@example.com")
    _held_orders(db, merchant, hoarder, MAX_OPEN_PENDING_ORDERS)
    _cart(db, other, _produce(db, merchant, "Mangga"))

    assert _place(_client(db, other)) == 200


def test_place_order_is_rate_limited_per_user(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db, "busy@example.com")
    other, _ = _buyer(db, "calm@example.com")
    client = _client(db, user)
    limit = ACTION_LIMITS["order_place"].max_hits

    # Empty cart: each attempt is refused (400) but still counts.
    assert [_place(client) for _ in range(limit)] == [400] * limit
    resp = client.post("/orders/me/place", json={})
    assert resp.status_code == 429
    assert int(resp.headers["Retry-After"]) > 0
    # Another buyer has their own count.
    assert _place(_client(db, other)) == 400


def test_payment_checkout_is_rate_limited_per_user(db: Session) -> None:
    user, _ = _buyer(db, "busy@example.com")
    other, _ = _buyer(db, "calm@example.com")
    client = _client(db, user)
    limit = ACTION_LIMITS["payment_checkout"].max_hits

    # No such order: 404, before any PayMongo call, but the attempt counts.
    codes = [client.post("/payments/checkout/999").status_code for _ in range(limit)]
    assert codes == [404] * limit
    resp = client.post("/payments/checkout/999")
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers
    assert _client(db, other).post("/payments/checkout/999").status_code == 404
