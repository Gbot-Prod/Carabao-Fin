from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders, reviews
from app.core.database import Base
from app.models.cart import Cart  # noqa: F401 - registers the table
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.payout_batch import PayoutBatch  # noqa: F401 - registers the table
from app.models.produce import Produce  # noqa: F401 - registers the table
from app.models.review import Review
from app.models.shipment import Shipment  # noqa: F401 - registers the table
from app.models.shopPage import ShopPage  # noqa: F401 - registers the table
from app.models.transaction import Transaction  # noqa: F401 - registers the table
from app.models.user import User
from app.services.review_service import (
    ReviewError,
    ensure_reviewable,
    reviewer_display_name,
)
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

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def merchant(db):
    owner = make_user(db, "farmer@example.com")
    db.add(owner)
    db.flush()
    merchant = Merchant(
        user_id=owner.id,
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
    db.commit()
    return merchant


def _buyer(db, email="buyer@example.com", name="Juan dela Cruz"):
    user = make_user(db, email, name=name)
    db.add(user)
    db.flush()
    db.commit()
    return user, None  # (user, _): kept for the many call sites


@pytest.fixture
def buyer(db):
    return _buyer(db)


def _order(db, merchant, buyer, status="delivered", delivered_days_ago=1.0):
    user, _ = buyer
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status=status,
        total_price=1000,
        items=[],
        delivered_at=(
            datetime.now(UTC) - timedelta(days=delivered_days_ago)
            if status == "delivered"
            else None
        ),
        delivery_confirmed_by="buyer" if status == "delivered" else None,
    )
    db.add(order)
    db.commit()
    return order


def _client(db, user) -> TestClient:
    app = FastAPI()
    app.include_router(orders.router)
    app.include_router(reviews.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


# --- rules --------------------------------------------------------------------


def _ns_order(status="delivered", delivered_days_ago=1.0, merchant_id=1):
    return SimpleNamespace(
        status=status,
        merchant_id=merchant_id,
        delivered_at=(
            datetime.now(UTC) - timedelta(days=delivered_days_ago)
            if delivered_days_ago is not None
            else None
        ),
    )


@pytest.mark.parametrize(
    "status", ["pending", "shipped", "out_for_delivery", "cancelled"]
)
def test_undelivered_orders_are_not_reviewable(status):
    with pytest.raises(ReviewError) as exc:
        ensure_reviewable(_ns_order(status=status, delivered_days_ago=None))
    assert exc.value.status_code == 400


def test_review_window_closes(monkeypatch):
    monkeypatch.setenv("REVIEW_WINDOW_DAYS", "30")
    ensure_reviewable(_ns_order(delivered_days_ago=29))
    with pytest.raises(ReviewError):
        ensure_reviewable(_ns_order(delivered_days_ago=31))


def test_orders_of_removed_merchants_are_not_reviewable():
    with pytest.raises(ReviewError):
        ensure_reviewable(_ns_order(merchant_id=None))


def test_reviewer_name_hides_surname():
    assert (
        reviewer_display_name(SimpleNamespace(name="Juan dela Cruz")) == "Juan D."
    )
    assert reviewer_display_name(SimpleNamespace(name="Juan")) == "Juan"
    assert reviewer_display_name(SimpleNamespace(name=None)) == "Carabao buyer"
    assert reviewer_display_name(None) == "Former buyer"


# --- API ----------------------------------------------------------------------


def test_buyer_reviews_delivered_order_and_rating_updates(db, merchant, buyer):
    user, _ = buyer
    order = _order(db, merchant, buyer)

    resp = _client(db, user).post(
        f"/orders/me/{order.id}/review", json={"rating": 4, "comment": "  Fresh!  "}
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["rating"] == 4
    assert body["comment"] == "Fresh!"
    assert body["reviewer_name"] == "Juan D."
    assert body["editable_until"] is not None
    db.refresh(merchant)
    assert merchant.rating == 4.0
    assert merchant.rating_count == 1


def test_rating_is_average_across_buyers(db, merchant, buyer):
    other = _buyer(db, email="maria@example.com", name="Maria Santos")
    for who, stars in ((buyer, 5), (other, 2)):
        order = _order(db, merchant, who)
        resp = _client(db, who[0]).post(
            f"/orders/me/{order.id}/review", json={"rating": stars}
        )
        assert resp.status_code == 201

    db.refresh(merchant)
    assert merchant.rating == 3.5
    assert merchant.rating_count == 2


def test_one_review_per_order(db, merchant, buyer):
    user, _ = buyer
    order = _order(db, merchant, buyer)
    client = _client(db, user)

    assert (
        client.post(f"/orders/me/{order.id}/review", json={"rating": 5}).status_code
        == 201
    )
    resp = client.post(f"/orders/me/{order.id}/review", json={"rating": 1})

    assert resp.status_code == 409
    db.refresh(merchant)
    assert merchant.rating == 5.0
    assert merchant.rating_count == 1


def test_cannot_review_undelivered_order(db, merchant, buyer):
    user, _ = buyer
    order = _order(db, merchant, buyer, status="shipped")

    resp = _client(db, user).post(f"/orders/me/{order.id}/review", json={"rating": 5})

    assert resp.status_code == 400
    assert db.query(Review).count() == 0


def test_cannot_review_someone_elses_order(db, merchant, buyer):
    order = _order(db, merchant, buyer)
    stranger, _ = _buyer(db, email="stranger@example.com")

    resp = _client(db, stranger).post(
        f"/orders/me/{order.id}/review", json={"rating": 1}
    )

    assert resp.status_code == 404
    assert db.query(Review).count() == 0


@pytest.mark.parametrize("rating", [0, 6])
def test_rating_must_be_one_to_five(db, merchant, buyer, rating):
    user, _ = buyer
    order = _order(db, merchant, buyer)

    resp = _client(db, user).post(
        f"/orders/me/{order.id}/review", json={"rating": rating}
    )

    assert resp.status_code == 422


def test_edit_review_recomputes_rating(db, merchant, buyer):
    user, _ = buyer
    order = _order(db, merchant, buyer)
    client = _client(db, user)
    client.post(f"/orders/me/{order.id}/review", json={"rating": 2})

    resp = client.patch(
        f"/orders/me/{order.id}/review", json={"rating": 5, "comment": "Better"}
    )

    assert resp.status_code == 200
    assert resp.json()["comment"] == "Better"
    db.refresh(merchant)
    assert merchant.rating == 5.0
    assert merchant.rating_count == 1


def test_edit_rejected_after_window(db, merchant, buyer, monkeypatch):
    user, _ = buyer
    order = _order(db, merchant, buyer, delivered_days_ago=10)
    client = _client(db, user)
    assert (
        client.post(f"/orders/me/{order.id}/review", json={"rating": 3}).status_code
        == 201
    )

    monkeypatch.setenv("REVIEW_WINDOW_DAYS", "5")
    resp = client.patch(f"/orders/me/{order.id}/review", json={"rating": 1})

    assert resp.status_code == 400
    db.refresh(merchant)
    assert merchant.rating == 3.0


def test_list_merchant_reviews_newest_first(db, merchant, buyer):
    user, _ = buyer
    client = _client(db, user)
    for stars in (3, 5):
        order = _order(db, merchant, buyer)
        client.post(f"/orders/me/{order.id}/review", json={"rating": stars})

    resp = client.get(f"/merchants/{merchant.id}/reviews?limit=10")

    assert resp.status_code == 200
    body = resp.json()
    assert body["rating"] == 4.0
    assert body["rating_count"] == 2
    assert [r["rating"] for r in body["reviews"]] == [5, 3]


def test_review_survives_buyer_removing_order_from_history(db, merchant, buyer):
    user, _ = buyer
    order = _order(db, merchant, buyer)
    client = _client(db, user)
    client.post(f"/orders/me/{order.id}/review", json={"rating": 4})

    assert client.delete(f"/orders/me/history/{order.id}").status_code == 204

    db.expire_all()
    review = db.query(Review).one()
    assert review.order_id is None
    assert db.get(Merchant, merchant.id).rating_count == 1


def test_order_detail_includes_review_state(db, merchant, buyer):
    user, _ = buyer
    order = _order(db, merchant, buyer)
    client = _client(db, user)

    before = client.get(f"/orders/me/{order.id}").json()
    assert before["status"] == "delivered"
    assert before["can_review"] is True
    assert before["review"] is None

    client.post(f"/orders/me/{order.id}/review", json={"rating": 5})
    after = client.get(f"/orders/me/{order.id}").json()
    assert after["can_review"] is False
    assert after["review"]["rating"] == 5


def test_order_detail_is_private(db, merchant, buyer):
    order = _order(db, merchant, buyer)
    stranger, _ = _buyer(db, email="stranger@example.com")

    assert _client(db, stranger).get(f"/orders/me/{order.id}").status_code == 404


# --- merchant's own reviews ---------------------------------------------------


def _owner(db, merchant):
    return db.get(User, merchant.user_id)


def _review(client, order, rating, comment=None):
    resp = client.post(
        f"/orders/me/{order.id}/review", json={"rating": rating, "comment": comment}
    )
    assert resp.status_code == 201


def test_public_reviews_hide_order_id(db, merchant, buyer):
    user, _ = buyer
    _review(_client(db, user), _order(db, merchant, buyer), 4)

    review = (
        _client(db, user).get(f"/merchants/{merchant.id}/reviews").json()["reviews"][0]
    )
    assert "order_id" not in review
    assert "editable_until" not in review


def test_my_merchant_reviews_summary_and_order_link(db, merchant, buyer):
    user, _ = buyer
    buyer_client = _client(db, user)
    first = _order(db, merchant, buyer)
    _review(buyer_client, first, 5, "Fresh and sweet")
    _review(buyer_client, _order(db, merchant, buyer), 2)
    _review(buyer_client, _order(db, merchant, buyer), 5)

    resp = _client(db, _owner(db, merchant)).get("/merchants/me/reviews")

    assert resp.status_code == 200
    body = resp.json()
    assert body["rating"] == 4.0
    assert body["rating_count"] == 3
    assert body["rating_breakdown"] == {"1": 0, "2": 1, "3": 0, "4": 0, "5": 2}
    assert body["with_comment_count"] == 1
    assert body["total"] == 3
    oldest = body["reviews"][-1]
    assert oldest["order_id"] == first.id
    assert oldest["comment"] == "Fresh and sweet"


def test_my_merchant_reviews_filters(db, merchant, buyer):
    user, _ = buyer
    buyer_client = _client(db, user)
    _review(buyer_client, _order(db, merchant, buyer), 1, "Wilted")
    _review(buyer_client, _order(db, merchant, buyer), 2)
    _review(buyer_client, _order(db, merchant, buyer), 5, "Great")
    client = _client(db, _owner(db, merchant))

    low = client.get("/merchants/me/reviews?rating=1&rating=2").json()
    assert low["total"] == 2
    assert sorted(r["rating"] for r in low["reviews"]) == [1, 2]
    # The summary always covers every review, whatever the filter.
    assert low["rating_count"] == 3

    commented = client.get("/merchants/me/reviews?has_comment=true").json()
    assert sorted(r["rating"] for r in commented["reviews"]) == [1, 5]

    both = client.get("/merchants/me/reviews?rating=1&has_comment=false").json()
    assert both["total"] == 0

    assert client.get("/merchants/me/reviews?rating=6").status_code == 422


def test_my_merchant_reviews_requires_merchant_profile(db, merchant, buyer):
    user, _ = buyer
    assert _client(db, user).get("/merchants/me/reviews").status_code == 404
