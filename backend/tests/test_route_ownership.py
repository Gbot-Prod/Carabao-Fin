"""CF-0044 (B15): cross-user and caller checks on routes that had no tests.

Payments (`/payments/checkout/{order_id}`, its cancel, `/payments/transactions/*`)
must answer 404 for another buyer's order or transaction (same as a missing
one, so ids can't be probed) and change nothing. `/carts/me` and `/users/me`
only ever read or write the caller's row. The internal email routes are only
for the Next.js server and need the shared secret.
"""

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import carts, email, payments, users
from app.models.cart import Cart
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.produce import Produce
from app.models.statuses import OrderStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from tests.shared_fixtures import _buyer

SECRET = "test-internal-secret"


def _client(db: Session, user: User, *routers: Any) -> TestClient:
    app = FastAPI()
    for router in routers:
        app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _order(db: Session, merchant: Merchant, user: User) -> Order:
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status=OrderStatus.PENDING,
        total_price=500,
        items=[{"produce_id": 1, "name": "Talong", "quantity": 2, "price": 250}],
    )
    db.add(order)
    db.commit()
    return order


def _txn(db: Session, order: Order) -> Transaction:
    # No PayMongo session id, so reading it never reaches PayMongo.
    txn = Transaction(
        order_id=order.id,
        merchant_id=order.merchant_id,
        user_id=order.user_id,
        amount=order.total_price,
        platform_fee=10,
        merchant_amount=order.total_price - 10,
        status=TransactionStatus.PENDING,
    )
    db.add(txn)
    db.commit()
    return txn


@pytest.fixture
def two_buyers(db: Session) -> tuple[User, User]:
    owner, _ = _buyer(db, "owner@example.com", "Ana Santos")
    other, _ = _buyer(db, "other@example.com", "Ben Reyes")
    return owner, other


def test_other_buyer_cannot_read_transactions(
    db: Session, merchant: Merchant, two_buyers: tuple[User, User]
) -> None:
    owner, other = two_buyers
    order = _order(db, merchant, owner)
    txn = _txn(db, order)

    nosy = _client(db, other, payments.router)
    assert nosy.get(f"/payments/transactions/{txn.id}").status_code == 404
    assert nosy.get(f"/payments/transactions/order/{order.id}").status_code == 404
    # Same answer as an id that does not exist.
    assert nosy.get("/payments/transactions/9999").status_code == 404

    mine = _client(db, owner, payments.router)
    resp = mine.get(f"/payments/transactions/{txn.id}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == txn.id
    resp = mine.get(f"/payments/transactions/order/{order.id}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == txn.id


def test_other_buyer_cannot_start_or_cancel_checkout(
    db: Session,
    merchant: Merchant,
    two_buyers: tuple[User, User],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner, other = two_buyers
    order = _order(db, merchant, owner)
    txn = _txn(db, order)

    def no_paymongo(*_: Any, **__: Any) -> None:
        raise AssertionError("PayMongo must not be called for another buyer's order")

    monkeypatch.setattr(payments, "create_checkout_session", no_paymongo, raising=False)
    monkeypatch.setattr(payments, "retrieve_checkout_session", no_paymongo)

    nosy = _client(db, other, payments.router)
    assert nosy.post(f"/payments/checkout/{order.id}").status_code == 404
    assert nosy.post(f"/payments/checkout/{order.id}/cancel").status_code == 404

    db.expire_all()
    kept = db.get(Order, order.id)
    assert kept is not None and kept.status == OrderStatus.PENDING
    kept_txn = db.get(Transaction, txn.id)
    assert kept_txn is not None and kept_txn.status == TransactionStatus.PENDING
    assert db.query(Transaction).count() == 1


def test_cart_routes_only_touch_the_callers_cart(
    db: Session, merchant: Merchant, two_buyers: tuple[User, User]
) -> None:
    owner, other = two_buyers
    talong = Produce(merchant_id=merchant.id, name="Talong", price=50, stock_quantity=9)
    mangga = Produce(merchant_id=merchant.id, name="Mangga", price=80, stock_quantity=9)
    db.add_all([talong, mangga])
    db.commit()

    put = _client(db, owner, carts.router).put(
        "/carts/me", json={"items": [{"produce_id": talong.id, "quantity": 2}]}
    )
    assert put.status_code == 200, put.text

    nosy = _client(db, other, carts.router)
    mine = nosy.get("/carts/me").json()
    assert mine["user_id"] == other.id and mine["items"] == []
    # A client-sent owner field is refused, not used.
    smuggled = nosy.put(
        "/carts/me",
        json={"user_id": owner.id, "items": [{"produce_id": mangga.id, "quantity": 1}]},
    )
    assert smuggled.status_code == 422
    assert nosy.put(
        "/carts/me", json={"items": [{"produce_id": mangga.id, "quantity": 1}]}
    ).status_code == 200

    db.expire_all()
    owner_cart = db.query(Cart).filter(Cart.user_id == owner.id).one()
    lines: list[dict[str, Any]] = list(owner_cart.items)
    assert [(line["produce_id"], line["quantity"]) for line in lines] == [
        (talong.id, 2)
    ]


@pytest.mark.parametrize(
    "body",
    [
        {"id": 1},
        {"is_admin": True},
        {"phone_verified": True},
        {"email": "taken@example.com"},
        {"notifications_preferences": {}, "status": "active"},
    ],
)
def test_profile_update_refuses_fields_it_does_not_own(
    db: Session, two_buyers: tuple[User, User], body: dict[str, Any]
) -> None:
    owner, _ = two_buyers
    before = (owner.id, owner.phone_verified, dict(owner.notifications_preferences))

    resp = _client(db, owner, users.router).patch("/users/me", json=body)

    assert resp.status_code == 422
    db.expire_all()
    row = db.get(User, owner.id)
    assert row is not None
    after = (row.id, row.phone_verified, dict(row.notifications_preferences))
    assert after == before


def test_profile_update_changes_only_the_caller(
    db: Session, two_buyers: tuple[User, User]
) -> None:
    owner, other = two_buyers
    prefs = {"sms": False}

    resp = _client(db, owner, users.router).patch(
        "/users/me", json={"notifications_preferences": prefs}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == owner.id
    db.expire_all()
    assert db.get(User, owner.id).notifications_preferences == prefs  # type: ignore[union-attr]
    assert db.get(User, other.id).notifications_preferences != prefs  # type: ignore[union-attr]


def _email_client() -> TestClient:
    app = FastAPI()
    app.include_router(email.router)
    return TestClient(app)


VERIFY = ("/email/send-verification", {"to": "a@example.com", "verification_url": "https://x/v"})
RESET = ("/email/send-password-reset", {"to": "a@example.com", "reset_url": "https://x/r"})


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []
    def record(**kw: str) -> None:
        calls.append(kw["to"])

    monkeypatch.setattr(email, "send_verification_email", record)
    monkeypatch.setattr(email, "send_password_reset_email", record)
    return calls


@pytest.mark.parametrize("route", [VERIFY, RESET])
@pytest.mark.parametrize("header", [None, "", "wrong-secret"])
def test_internal_email_routes_need_the_secret(
    monkeypatch: pytest.MonkeyPatch,
    sent: list[str],
    route: tuple[str, dict[str, str]],
    header: str | None,
) -> None:
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", SECRET)
    path, body = route
    headers = {} if header is None else {"X-Internal-Auth-Sync-Secret": header}

    resp = _email_client().post(path, json=body, headers=headers)

    assert resp.status_code == 401
    assert sent == []


@pytest.mark.parametrize("route", [VERIFY, RESET])
def test_internal_email_routes_fail_closed_without_a_configured_secret(
    monkeypatch: pytest.MonkeyPatch, sent: list[str], route: tuple[str, dict[str, str]]
) -> None:
    monkeypatch.delenv("AUTH_SYNC_SHARED_SECRET", raising=False)
    path, body = route

    resp = _email_client().post(
        path, json=body, headers={"X-Internal-Auth-Sync-Secret": ""}
    )

    assert resp.status_code == 500
    assert sent == []


@pytest.mark.parametrize("route", [VERIFY, RESET])
def test_internal_email_routes_send_with_the_secret(
    monkeypatch: pytest.MonkeyPatch, sent: list[str], route: tuple[str, dict[str, str]]
) -> None:
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", SECRET)
    path, body = route

    resp = _email_client().post(
        path, json=body, headers={"X-Internal-Auth-Sync-Secret": SECRET}
    )

    assert resp.status_code == 200
    assert sent == ["a@example.com"]
