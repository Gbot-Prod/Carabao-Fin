import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders, users
from app.core.database import Base
from app.models.cart import Cart  # noqa: F401 - registers the table
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.payout_batch import PayoutBatch  # noqa: F401 - registers the table
from app.models.produce import Produce  # noqa: F401 - registers the table
from app.models.shipment import Shipment
from app.models.shopPage import ShopPage  # noqa: F401 - registers the table
from app.models.transaction import Transaction
from app.models.user import User
from tests.account_delete import delete_account
from tests.better_auth import make_user


@compiles(JSONB, "sqlite")
def _jsonb_as_json(_type, _compiler, **_):
    return "JSON"


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Enforce FKs like Postgres does, so a passing delete proves no violation.
    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def _merchant(db, user):
    merchant = Merchant(
        user_id=user.id,
        merchant_name="Dela Cruz Farm",
        contact_number="639171234567",
        region="Region III",
        province="Bulacan",
        address="Purok 1",
        postal_code="3000",
        available_days=["mon"],
        operating_hours={},
        seller_type="individual_farmer",
        rsbsa_document_path="rsbsa/1.pdf",
        gov_id_type="Passport",
        gov_id_document_path="gov-id/x.pdf",
    )
    db.add(merchant)
    db.flush()
    return merchant


@pytest.fixture
def seller(db):
    user = make_user(db, "farmer@example.com")
    db.add(user)
    db.flush()
    merchant = _merchant(db, user)
    db.commit()
    return user, merchant


@pytest.fixture
def buyer(db):
    user = make_user(db, "buyer@example.com")
    db.add(user)
    db.flush()
    db.commit()
    return user, None  # (user, _): kept for the many call sites


def _client(db, user) -> TestClient:
    app = FastAPI()
    app.include_router(users.router)
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _order(db, merchant, buyer, status):
    user, _ = buyer
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status=status,
        total_price=1000,
        items=[],
    )
    db.add(order)
    db.flush()
    return order


def _transaction(db, order, status):
    txn = Transaction(
        order_id=order.id,
        merchant_id=order.merchant_id,
        user_id=order.user_id,
        amount=1000,
        platform_fee=10,
        merchant_amount=990,
        status=status,
    )
    db.add(txn)
    db.flush()
    return txn


@pytest.mark.parametrize(
    ("order_status", "txn_status", "expected"),
    [
        ("pending", None, {"active_orders": 1}),
        ("shipped", "paid", {"active_orders": 1}),
        # CF-0041: money still owed to the buyer keeps the account.
        ("cancelled", "refund_pending", {"refunds_pending": 1}),
    ],
    ids=["pending-order", "in-transit", "refund-owed"],
)
def test_account_delete_blocked_by_order_history(
    db, seller, buyer, order_status, txn_status, expected
):
    _, merchant = seller
    user, _ = buyer
    order = _order(db, merchant, buyer, order_status)
    if txn_status:
        _transaction(db, order, txn_status)
    db.commit()

    resp = delete_account(_client(db, user))

    assert resp.status_code == 409
    assert resp.json()["detail"]["blockers"] == expected
    db.expire_all()
    assert db.get(User, user.id) is not None
    assert db.query(Order).count() == 1


def test_account_delete_blocked_for_merchant_with_sales(db, seller, buyer):
    user, merchant = seller
    _transaction(db, _order(db, merchant, buyer, "delivered"), "paid")
    db.add(Shipment(merchant_id=merchant.id))
    db.commit()

    resp = delete_account(_client(db, user))

    assert resp.status_code == 409
    assert resp.json()["detail"]["blockers"] == {
        "merchant_payment_records": 1,
        "shipments": 1,
    }
    db.expire_all()
    assert db.get(Merchant, merchant.id) is not None


def test_account_delete_succeeds_with_unpaid_closed_orders(db, seller, buyer):
    _, merchant = seller
    user, _ = buyer
    _order(db, merchant, buyer, "cancelled")
    db.commit()

    resp = delete_account(_client(db, user))

    assert resp.status_code == 204
    db.expire_all()
    assert db.get(User, user.id) is None
    assert db.query(Order).count() == 0


def test_account_delete_succeeds_for_merchant_without_sales(db, seller):
    user, merchant = seller
    db.add(MerchantPayoutInfo(merchant_id=merchant.id, payout_type="gcash"))
    db.add(
        MerchantApplication(
            user_id=user.id,
            merchant_id=merchant.id,
            status="approved",
            merchant_name="Dela Cruz Farm",
            seller_type="individual_farmer",
            contact_email="farmer@example.com",
            contact_number="639171234567",
            rsbsa_document_path="rsbsa/1.pdf",
            gov_id_type="Passport",
            gov_id_document_path="gov-id/x.pdf",
            region="Region III",
            province="Bulacan",
            city="Malolos",
            address="Purok 1",
            postal_code="3000",
            available_days=["mon"],
        )
    )
    db.commit()

    resp = delete_account(_client(db, user))

    assert resp.status_code == 204
    db.expire_all()
    assert db.get(User, user.id) is None
    assert db.query(Merchant).count() == 0
    assert db.query(MerchantApplication).count() == 0
    assert db.query(MerchantPayoutInfo).count() == 0



def test_account_delete_removes_identity_documents(db, seller, r2_deleted):
    """CF-0040: the ID scans leave R2 with the account."""
    user, _ = seller
    db.add(
        MerchantApplication(
            user_id=user.id,
            status="rejected",
            merchant_name="Dela Cruz Farm",
            seller_type="individual_farmer",
            contact_email="farmer@example.com",
            contact_number="639171234567",
            rsbsa_document_path="rsbsa/2.pdf",
            gov_id_type="Passport",
            gov_id_document_path="gov-id/y.pdf",
            region="Region III",
            province="Bulacan",
            city="Malolos",
            address="Purok 1",
            postal_code="3000",
            available_days=["mon"],
        )
    )
    db.commit()

    assert delete_account(_client(db, user)).status_code == 204
    assert sorted(r2_deleted) == [
        "gov-id/x.pdf",
        "gov-id/y.pdf",
        "rsbsa/1.pdf",
        "rsbsa/2.pdf",
    ]


def test_account_is_kept_when_documents_cannot_be_deleted(db, seller, monkeypatch):
    from app.services import r2_service

    user, _ = seller

    def fail(_path):
        raise RuntimeError("R2 down")

    monkeypatch.setattr(r2_service, "delete_private_document", fail)

    assert delete_account(_client(db, user)).status_code == 502
    db.expire_all()
    assert db.get(User, user.id) is not None


@pytest.mark.parametrize(
    ("order_status", "txn_status"),
    [("delivered", "paid"), ("cancelled", "refunded"), ("cancelled", "expired")],
)
def test_account_delete_keeps_payment_records_without_the_buyer(
    db, seller, buyer, order_status, txn_status
):
    """CF-0041: closed orders with money history stay, anonymized."""
    from app.models.chat import ChatMessage, Conversation

    _, merchant = seller
    user, _ = buyer
    order = _order(db, merchant, buyer, order_status)
    order.delivery_address = "12 Mabini St"
    order.delivery_lat, order.delivery_lng = 14.8, 120.8
    order.notes = "Gate 2"
    txn = _transaction(db, order, txn_status)
    convo = Conversation(kind="order", order_id=order.id)
    db.add(convo)
    db.flush()
    db.add(
        ChatMessage(
            conversation_id=convo.id,
            sender_id=user.id,
            sender_role="buyer",
            body="My number is 0917...",
        )
    )
    unpaid = _order(db, merchant, buyer, "cancelled")
    db.commit()
    order_id, txn_id, unpaid_id = order.id, txn.id, unpaid.id

    resp = delete_account(_client(db, user))

    assert resp.status_code == 204, resp.text
    db.expire_all()
    assert db.get(User, user.id) is None
    kept = db.get(Order, order_id)
    assert kept is not None
    assert kept.user_id is None
    assert (kept.delivery_address, kept.delivery_lat, kept.notes) == (None, None, None)
    assert kept.total_price == 1000
    record = db.get(Transaction, txn_id)
    assert record.user_id is None
    assert record.amount == 1000 and record.status == txn_status
    assert db.query(Conversation).count() == 0
    assert db.query(ChatMessage).count() == 0
    assert db.get(Order, unpaid_id) is None


@pytest.mark.parametrize("txn_status", ["paid", "expired", "refunded"])
def test_history_remove_hides_an_order_with_payment(db, seller, buyer, txn_status):
    """CF-0070 (B10): was a 409 stopgap; the order is hidden, never deleted,
    so the payment record and the farm's view keep it."""
    _, merchant = seller
    user, _ = buyer
    status = "delivered" if txn_status == "paid" else "cancelled"
    order = _order(db, merchant, buyer, status)
    _transaction(db, order, txn_status)
    db.commit()
    client = _client(db, user)

    resp = client.delete(f"/orders/me/history/{order.id}")

    assert resp.status_code == 204
    db.expire_all()
    kept = db.get(Order, order.id)
    assert kept is not None and kept.hidden_by_buyer_at is not None
    assert db.query(Transaction).count() == 1
    assert order.id not in [o["id"] for o in client.get("/orders/me/history").json()]


def test_history_remove_hides_an_unpaid_cancelled_order(db, seller, buyer):
    _, merchant = seller
    user, _ = buyer
    order = _order(db, merchant, buyer, "cancelled")
    db.commit()
    client = _client(db, user)

    resp = client.delete(f"/orders/me/history/{order.id}")
    again = client.delete(f"/orders/me/history/{order.id}")  # idempotent

    assert (resp.status_code, again.status_code) == (204, 204)
    db.expire_all()
    kept = db.get(Order, order.id)
    assert kept is not None and kept.hidden_by_buyer_at is not None
    assert client.get("/orders/me/history").json() == []


# ── The SMS code that confirms the delete ────────────────────────────────


def test_account_delete_needs_the_code(db, buyer):
    user, _ = buyer
    client = _client(db, user)

    assert client.delete("/users/me").status_code == 422  # no code at all
    client.post("/users/me/delete-code")
    resp = client.request("DELETE", "/users/me", json={"code": "000000"})

    assert resp.status_code == 400
    db.expire_all()
    assert db.get(User, user.id) is not None


def test_account_delete_code_needs_a_verified_number(db):
    user = make_user(db, "google@example.com", phone_number=None)
    db.commit()

    resp = _client(db, user).post("/users/me/delete-code")

    assert resp.status_code == 400
    assert "mobile number" in resp.json()["detail"]


def test_account_delete_code_is_not_sent_when_blocked(db, seller, buyer):
    from tests import payout_codes

    _, merchant = seller
    user, _ = buyer
    _transaction(db, _order(db, merchant, buyer, "shipped"), "paid")
    db.commit()

    resp = _client(db, user).post("/users/me/delete-code")

    assert resp.status_code == 409
    assert payout_codes.SENT == []


def test_account_delete_needs_the_password_first(db, buyer):
    from tests import payout_codes
    from tests.better_auth import add_password

    user, _ = buyer
    add_password(db, user, "Correct-horse-1!")
    client = _client(db, user)

    for body in (None, {"password": "Wrong-horse-1!"}):
        resp = client.post("/users/me/delete-code", json=body)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Your password is not correct."
    assert payout_codes.SENT == []  # no SMS before the password is right

    resp = delete_account(client, password="Correct-horse-1!")

    assert resp.status_code == 204
    db.expire_all()
    assert db.get(User, user.id) is None


def test_account_delete_password_tries_are_limited(db, buyer):
    from tests.better_auth import add_password

    user, _ = buyer
    add_password(db, user, "Correct-horse-1!")
    client = _client(db, user)

    codes = [
        client.post("/users/me/delete-code", json={"password": "nope"}).status_code
        for _ in range(6)
    ]

    assert codes == [400] * 5 + [429]
