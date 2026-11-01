from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants, orders
from app.core.database import Base
from app.models.cart import Cart
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.payout_batch import PayoutBatch, PayoutBatchItem
from app.models.produce import Produce
from app.models.shipment import Shipment  # noqa: F401 - registers the table
from app.models.shopPage import ShopPage
from app.models.transaction import Transaction
from app.models.user import User
from app.services.merchant_service import create_merchant_from_application


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
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def seller(db):
    user = User(email="farmer@example.com")
    db.add(user)
    db.flush()
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
        price_range_min=10,
        price_range_max=100,
        business_type="individual",
        rsbsa_document_path="rsbsa/1.pdf",
    )
    db.add(merchant)
    db.flush()
    db.add(Produce(merchant_id=merchant.id, name="Tomato", price=50, stock_quantity=5))
    db.add(ShopPage(merchant_id=merchant.id, title="Dela Cruz", slug="dela-cruz"))
    db.add(MerchantPayoutInfo(merchant_id=merchant.id, payout_type="gcash"))
    db.commit()
    return user, merchant


@pytest.fixture
def buyer(db):
    user = User(email="buyer@example.com")
    db.add(user)
    db.flush()
    history = OrderHistory(user_id=user.id)
    db.add(history)
    db.commit()
    return user, history


def _client(db, user) -> TestClient:
    app = FastAPI()
    app.include_router(merchants.router)
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _order(db, merchant, buyer, status):
    user, history = buyer
    order = Order(
        order_history_id=history.id,
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


def _batch(db, txn, status):
    batch = PayoutBatch(
        merchant_id=txn.merchant_id,
        period_date=date(2026, 10, 1),
        transaction_count=1,
        gross_amount=txn.merchant_amount,
        status=status,
    )
    db.add(batch)
    db.flush()
    db.add(PayoutBatchItem(batch_id=batch.id, transaction_id=txn.id, amount=990))
    db.flush()
    return batch


def _setup_active_order(status):
    def setup(db, merchant, buyer):
        _order(db, merchant, buyer, status)

    return setup


def _setup_transaction(order_status, txn_status, batch_status=None):
    def setup(db, merchant, buyer):
        txn = _transaction(db, _order(db, merchant, buyer, order_status), txn_status)
        if batch_status:
            _batch(db, txn, batch_status)

    return setup


@pytest.mark.parametrize(
    ("setup", "expected"),
    [
        (_setup_active_order("pending"), {"active_orders": 1}),
        (_setup_active_order("processing"), {"active_orders": 1}),
        (_setup_active_order("shipped"), {"active_orders": 1}),
        (_setup_active_order("out_for_delivery"), {"active_orders": 1}),
        (
            _setup_transaction("cancelled", "pending"),
            {"pending_payments": 1},
        ),
        (
            _setup_transaction("cancelled", "refund_pending"),
            {"refunds_pending": 1},
        ),
        (
            _setup_transaction("delivered", "paid"),
            {"unpaid_earnings": 990},
        ),
        (
            _setup_transaction("delivered", "paid", "approved"),
            {"unpaid_earnings": 990, "open_payouts": 1},
        ),
        (
            _setup_transaction("delivered", "paid", "failed"),
            {"unpaid_earnings": 990},
        ),
    ],
    ids=[
        "pending-order",
        "processing-order",
        "shipped-order",
        "out-for-delivery-order",
        "checkout-in-progress",
        "refund-pending",
        "unbatched-earnings",
        "open-payout-batch",
        "failed-payout-batch",
    ],
)
def test_delete_blocked_while_obligations_remain(db, seller, buyer, setup, expected):
    user, merchant = seller
    setup(db, merchant, buyer)
    db.commit()

    def snapshot():
        return [db.query(m).count() for m in (Order, Transaction, PayoutBatch)]

    before = snapshot()

    resp = _client(db, user).delete("/merchants/me")

    assert resp.status_code == 409
    assert resp.json()["detail"]["blockers"] == expected
    db.refresh(merchant)
    assert merchant.deleted_at is None
    assert snapshot() == before


def test_delete_soft_deletes_and_keeps_financial_records(db, seller, buyer):
    user, merchant = seller
    delivered = _order(db, merchant, buyer, "delivered")
    released_txn = _transaction(db, delivered, "paid")
    released = _batch(db, released_txn, "released")
    cancelled = _order(db, merchant, buyer, "cancelled")
    _transaction(db, cancelled, "expired")
    db.add(
        MerchantApplication(
            user_id=user.id,
            merchant_id=merchant.id,
            status="approved",
            merchant_name="Dela Cruz Farm",
            business_type="individual",
            contact_email="farmer@example.com",
            contact_number="639171234567",
            rsbsa_document_path="rsbsa/1.pdf",
            region="Region III",
            province="Bulacan",
            city="Malolos",
            address="Purok 1",
            postal_code="3000",
            delivery_time=2,
            delivery_price=40,
            price_range_min=10,
            price_range_max=100,
            available_days=["mon"],
        )
    )
    db.commit()

    resp = _client(db, user).delete("/merchants/me")

    assert resp.status_code == 204
    db.expire_all()
    merchant = db.get(Merchant, merchant.id)
    assert merchant.deleted_at is not None
    assert merchant.contact_number is None
    assert db.query(Transaction).count() == 2
    assert db.get(PayoutBatch, released.id).status == "released"
    assert db.query(PayoutBatchItem).count() == 1
    assert db.query(MerchantPayoutInfo).count() == 1
    assert {o.merchant_id for o in db.query(Order)} == {merchant.id}
    assert db.query(Produce).count() == 1
    assert db.query(MerchantApplication).one().merchant_id is None


def test_deleted_merchant_is_hidden_everywhere(db, seller, buyer):
    user, merchant = seller
    client = _client(db, user)
    assert client.delete("/merchants/me").status_code == 204

    assert client.get("/merchants").json() == []
    assert client.get(f"/merchants/{merchant.id}").status_code == 404
    assert client.get(f"/merchants/{merchant.id}/produce").status_code == 404
    assert client.get(f"/merchants/{merchant.id}/shoppage").status_code == 404
    # Owner endpoints treat a closed profile as missing.
    assert client.get("/merchants/me/performance").status_code == 404
    assert client.post("/produce/", json={"name": "Onion"}).status_code == 404
    assert client.delete("/merchants/me").status_code == 404


def test_active_merchant_still_listed(db, seller):
    user, merchant = seller
    client = _client(db, user)

    assert [m["id"] for m in client.get("/merchants").json()] == [merchant.id]
    assert client.get(f"/merchants/{merchant.id}/shoppage").status_code == 200


def test_checkout_rejected_for_deleted_merchant(db, seller, buyer):
    user, merchant = seller
    assert _client(db, user).delete("/merchants/me").status_code == 204
    buyer_user, _ = buyer
    produce = db.query(Produce).one()
    db.add(
        Cart(user_id=buyer_user.id, items=[{"produce_id": produce.id, "quantity": 2}])
    )
    db.commit()

    resp = _client(db, buyer_user).post("/orders/me/place", json={})

    assert resp.status_code == 400
    assert resp.json()["detail"] == "This merchant is no longer accepting orders"
    db.rollback()
    assert db.query(Order).count() == 0
    assert db.get(Produce, produce.id).stock_quantity == 5


def test_reapproved_application_reactivates_deleted_merchant(db, seller):
    user, merchant = seller
    assert _client(db, user).delete("/merchants/me").status_code == 204
    application = MerchantApplication(
        user_id=user.id,
        status="approved",
        merchant_name="Dela Cruz Farm II",
        business_type="individual",
        contact_email="farmer@example.com",
        contact_number="639179999999",
        rsbsa_document_path="rsbsa/2.pdf",
        region="Region III",
        province="Bulacan",
        city="Malolos",
        address="Purok 2",
        postal_code="3000",
        delivery_time=2,
        delivery_price=40,
        price_range_min=10,
        price_range_max=100,
        available_days=["tue"],
    )
    db.add(application)
    db.flush()

    reactivated = create_merchant_from_application(db, application)

    assert reactivated.id == merchant.id
    assert reactivated.deleted_at is None
    assert reactivated.merchant_name == "Dela Cruz Farm II"
    assert reactivated.contact_number == "639179999999"


def test_active_merchant_cannot_be_created_twice(db, seller):
    user, _ = seller
    application = MerchantApplication(user_id=user.id, merchant_name="Dup")

    with pytest.raises(ValueError, match="already has a merchant profile"):
        create_merchant_from_application(db, application)
