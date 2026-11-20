"""CF-0036: the buyer's order history is sorted, filtered and paged in SQL."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.review import Review
from app.models.statuses import OrderStatus
from app.models.user import User
from tests.shared_fixtures import _buyer
from tests.test_merchant_listings import _other_merchant

PAGE = "/orders/me/history/page"
START = datetime(2026, 1, 1, 8, 0, tzinfo=UTC)


def _client(db: Session, user: User) -> TestClient:
    app = FastAPI()
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _orders(
    db: Session,
    user: User,
    merchant: Merchant,
    count: int,
    status: OrderStatus = OrderStatus.DELIVERED,
    start_day: int = 0,
) -> list[Order]:
    made = []
    for i in range(count):
        order = Order(
            user_id=user.id,
            merchant_id=merchant.id,
            status=status,
            total_price=100 + i,
            items=[],
            ordered_at=START + timedelta(days=start_day + i),
        )
        db.add(order)
        made.append(order)
    db.commit()
    return made


def _ids(body: dict[str, Any]) -> list[int]:
    return [row["order_id"] for row in body["items"]]


def test_pages_are_newest_first_with_a_total(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db)
    made = _orders(db, user, merchant, 25)
    newest_first = [o.id for o in reversed(made)]
    client = _client(db, user)

    pages = [
        client.get(PAGE, params={"page": n, "page_size": 10}).json() for n in (1, 2, 3)
    ]

    assert [p["total"] for p in pages] == [25, 25, 25]
    assert [len(p["items"]) for p in pages] == [10, 10, 5]
    assert _ids(pages[0]) + _ids(pages[1]) + _ids(pages[2]) == newest_first
    assert pages[0]["page"] == 1 and pages[0]["page_size"] == 10


def test_page_past_the_end_is_empty(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db)
    _orders(db, user, merchant, 3)
    body = _client(db, user).get(PAGE, params={"page": 5}).json()
    assert body["items"] == [] and body["total"] == 3


def test_only_the_buyers_own_orders(db: Session, merchant: Merchant) -> None:
    me, _ = _buyer(db)
    other, _ = _buyer(db, email="other@example.com")
    _orders(db, me, merchant, 2)
    _orders(db, other, merchant, 4)
    body = _client(db, me).get(PAGE).json()
    assert body["total"] == 2
    assert all(row["merchant_id"] == merchant.id for row in body["items"])
    assert set(_ids(body)) == {
        o.id for o in db.query(Order).filter(Order.user_id == me.id)
    }


def test_status_filter_groups(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db)
    delivered = _orders(db, user, merchant, 2)
    cancelled = _orders(db, user, merchant, 1, OrderStatus.CANCELLED, 10)
    mismatch = _orders(db, user, merchant, 1, OrderStatus.PAYMENT_MISMATCH, 11)
    active = _orders(db, user, merchant, 1, OrderStatus.SHIPPED, 12)
    client = _client(db, user)

    def ids(status: str) -> set[int]:
        return set(_ids(client.get(PAGE, params={"status": status}).json()))

    assert ids("delivered") == {o.id for o in delivered}
    assert ids("cancelled") == {o.id for o in cancelled + mismatch}
    assert ids("active") == {o.id for o in active}
    assert client.get(PAGE, params={"status": "pending"}).status_code == 422


def test_order_tab_filters(db: Session, merchant: Merchant) -> None:
    """The web order tabs: To Pay, To Ship, To Receive."""
    user, _ = _buyer(db)
    to_pay = _orders(db, user, merchant, 1, OrderStatus.PENDING)
    to_ship = _orders(db, user, merchant, 1, OrderStatus.PROCESSING, 1)
    shipped = _orders(db, user, merchant, 1, OrderStatus.SHIPPED, 2)
    out = _orders(db, user, merchant, 1, OrderStatus.OUT_FOR_DELIVERY, 3)
    _orders(db, user, merchant, 1, OrderStatus.DELIVERED, 4)
    client = _client(db, user)

    def ids(status: str) -> set[int]:
        return set(_ids(client.get(PAGE, params={"status": status}).json()))

    assert ids("to_pay") == {o.id for o in to_pay}
    assert ids("to_ship") == {o.id for o in to_ship}
    assert ids("to_receive") == {o.id for o in shipped + out}


def test_search_by_product_name(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db)
    tomato, cabbage = _orders(db, user, merchant, 2)
    tomato.items = [{"produce": "Red Tomato", "quantity": 2, "price": 50}]
    cabbage.items = [{"produce": "Cabbage", "quantity": 1, "price": 80}]
    db.commit()
    client = _client(db, user)

    assert _ids(client.get(PAGE, params={"q": "tomato"}).json()) == [tomato.id]
    # A JSON key is not a product name.
    assert client.get(PAGE, params={"q": "price"}).json()["total"] == 0
    assert client.get(PAGE, params={"q": "%"}).json()["total"] == 0


def test_rows_carry_review_state(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db)
    open_one, done = _orders(db, user, merchant, 2)
    now = datetime.now(UTC)
    for order in (open_one, done):
        order.delivered_at = now
    db.add(
        Review(order_id=done.id, user_id=user.id, merchant_id=merchant.id, rating=5)
    )
    db.commit()

    rows = {
        row["order_id"]: row for row in _client(db, user).get(PAGE).json()["items"]
    }
    assert rows[open_one.id]["can_review"] is True
    assert rows[open_one.id]["reviewed"] is False
    assert rows[open_one.id]["review_deadline"] is not None
    assert rows[done.id]["can_review"] is False
    assert rows[done.id]["reviewed"] is True


def test_search_by_order_reference(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db)
    made = _orders(db, user, merchant, 3)
    target = made[1]
    client = _client(db, user)
    year = target.ordered_at.year
    for term in (
        f"CB-{year}-{target.id:04d}",
        f"cb-{year}-{target.id}",
        f"#{target.id}",
        str(target.id),
    ):
        body = client.get(PAGE, params={"q": term}).json()
        assert _ids(body) == [target.id], term


def test_search_by_reference_cannot_reach_another_buyers_order(
    db: Session, merchant: Merchant
) -> None:
    me, _ = _buyer(db)
    other, _ = _buyer(db, email="other@example.com")
    _orders(db, me, merchant, 1)
    (theirs,) = _orders(db, other, merchant, 1)
    body = _client(db, me).get(PAGE, params={"q": f"#{theirs.id}"}).json()
    assert body == {"items": [], "total": 0, "page": 1, "page_size": 10}


def test_search_by_farm_name_with_like_wildcards_escaped(
    db: Session, merchant: Merchant
) -> None:
    user, _ = _buyer(db)
    other_farm = _other_merchant(db)
    db.query(Merchant).filter(Merchant.id == other_farm.id).update(
        {"merchant_name": "Sunrise Orchard"}
    )
    mine = _orders(db, user, merchant, 2)  # "Dela Cruz Farm"
    _orders(db, user, other_farm, 3, start_day=5)
    client = _client(db, user)

    body = client.get(PAGE, params={"q": "dela cruz"}).json()
    assert set(_ids(body)) == {o.id for o in mine}
    assert body["total"] == 2
    # "%" and "_" are literal, not wildcards.
    assert client.get(PAGE, params={"q": "%"}).json()["total"] == 0
    assert client.get(PAGE, params={"q": "D_la"}).json()["total"] == 0


def test_bounds_on_paging_and_search(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db)
    client = _client(db, user)
    for params in ({"page_size": 51}, {"page_size": 0}, {"page": 0}, {"q": "x" * 101}):
        assert client.get(PAGE, params=params).status_code == 422, params


def test_plain_history_list_is_still_newest_first(
    db: Session, merchant: Merchant
) -> None:
    """The mobile app reads the unpaged list; it is now sorted by SQL."""
    user, _ = _buyer(db)
    made = _orders(db, user, merchant, 4)
    body = _client(db, user).get("/orders/me/history").json()
    assert [row["order_id"] for row in body] == [o.id for o in reversed(made)]
