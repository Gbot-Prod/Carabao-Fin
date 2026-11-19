"""CF-0042 (B14) with main's CF-0052: the cart flags lines that place-order
would refuse.

GET and PUT /carts/me rebuild each line from its live listing. Each line has
``unavailable_reason`` (text, main) and ``issue`` (a code, plus
``exceeds_stock``), and ``previous_price`` when the price changed since the
buyer saved it. PUT refuses a new or changed line that checkout would refuse
(main's rule); a saved line that goes bad later is flagged, not refused.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import carts
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.user import User
from app.services.produce_freshness import ph_today
from tests.shared_fixtures import _buyer
from tests.test_merchant_listings import _other_merchant


def _client(db: Session, user: User) -> TestClient:
    app = FastAPI()
    app.include_router(carts.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _produce(
    db: Session, merchant: Merchant, name: str, price: int = 50, stock: int = 10
) -> Produce:
    row = Produce(
        merchant_id=merchant.id, name=name, price=price, stock_quantity=stock
    )
    db.add(row)
    db.commit()
    return row


def _put(client: TestClient, *lines: tuple[Produce, int]) -> dict[str, dict[str, Any]]:
    resp = client.put(
        "/carts/me",
        json={"items": [{"produce_id": p.id, "quantity": q} for p, q in lines]},
    )
    assert resp.status_code == 200, resp.text
    return {i["id"]: i for i in resp.json()["items"]}


def _get(client: TestClient) -> dict[str, dict[str, Any]]:
    resp = client.get("/carts/me")
    assert resp.status_code == 200, resp.text
    return {i["id"]: i for i in resp.json()["items"]}


def test_good_lines_have_no_issue(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db)
    db.commit()
    talong = _produce(db, merchant, "Talong")

    line = _put(_client(db, user), (talong, 2))[str(talong.id)]

    assert line["issue"] is None
    assert line["previous_price"] is None


def test_lines_that_go_bad_after_saving_are_flagged(
    db: Session, merchant: Merchant
) -> None:
    user, _ = _buyer(db)
    db.commit()
    hidden = _produce(db, merchant, "Hidden")
    expired = _produce(db, merchant, "Expired")
    minimum = _produce(db, merchant, "Minimum")
    low = _produce(db, merchant, "Low", stock=10)
    client = _client(db, user)
    _put(client, (hidden, 1), (expired, 1), (minimum, 2), (low, 4))

    hidden.hidden_at = datetime.now(UTC)  # type: ignore[assignment]
    expired.best_before = ph_today() - timedelta(days=1)  # type: ignore[assignment]
    minimum.min_order_qty = 5  # type: ignore[assignment]
    low.stock_quantity = 3  # type: ignore[assignment]
    db.commit()
    lines = _get(client)

    assert lines[str(hidden.id)]["issue"] == "unavailable"
    assert lines[str(hidden.id)]["unavailable_reason"] == "is no longer available"
    assert lines[str(expired.id)]["issue"] == "expired"
    assert lines[str(minimum.id)]["issue"] == "below_minimum"
    assert lines[str(minimum.id)]["unavailable_reason"] == "has a minimum order of 5"
    # Stock is a code only; the text stays None (main CF-0052).
    assert lines[str(low.id)]["issue"] == "exceeds_stock"
    assert lines[str(low.id)]["unavailable_reason"] is None
    assert lines[str(low.id)]["stock_quantity"] == 3

    # Saving the same lines again keeps them, still flagged.
    again = _put(client, (hidden, 1), (expired, 1), (minimum, 2), (low, 4))
    assert again[str(hidden.id)]["issue"] == "unavailable"


def test_new_bad_lines_are_refused(db: Session, merchant: Merchant) -> None:
    owner = db.get(User, merchant.user_id)
    assert owner is not None
    user, _ = _buyer(db)
    db.commit()
    hidden = _produce(db, merchant, "Hidden")
    talong = _produce(db, merchant, "Talong", stock=3)
    hidden.hidden_at = datetime.now(UTC)  # type: ignore[assignment]
    db.commit()

    resp = _client(db, user).put(
        "/carts/me", json={"items": [{"produce_id": hidden.id, "quantity": 1}]}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "'Hidden' is no longer available"

    own = _client(db, owner).put(
        "/carts/me", json={"items": [{"produce_id": talong.id, "quantity": 1}]}
    )
    assert own.status_code == 400
    assert "own farm" in own.json()["detail"]

    # Over the stock is not refused: the cart shows the stock to cap it.
    line = _put(_client(db, user), (talong, 4))[str(talong.id)]
    assert line["issue"] == "exceeds_stock"


def test_suspended_farm_is_flagged(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db)
    db.commit()
    rival = _other_merchant(db)
    mangga = _produce(db, rival, "Mangga")
    client = _client(db, user)
    _put(client, (mangga, 1))

    rival.suspended_at = datetime.now(UTC)  # type: ignore[assignment]
    db.commit()

    assert _get(client)[str(mangga.id)]["issue"] == "farm_unavailable"


def test_get_reflects_changes_after_saving(db: Session, merchant: Merchant) -> None:
    """Price, stock and availability are read live, not from the saved line."""
    user, _ = _buyer(db)
    db.commit()
    talong = _produce(db, merchant, "Talong", price=50, stock=10)
    kamatis = _produce(db, merchant, "Kamatis")
    client = _client(db, user)
    _put(client, (talong, 4), (kamatis, 1))

    talong.price = 60  # type: ignore[assignment]
    talong.stock_quantity = 2  # type: ignore[assignment]
    db.delete(kamatis)
    db.commit()
    resp = client.get("/carts/me")

    lines = {i["id"]: i for i in resp.json()["items"]}
    assert lines[str(talong.id)]["price"] == 60
    assert lines[str(talong.id)]["previous_price"] == 50
    assert lines[str(talong.id)]["issue"] == "exceeds_stock"
    # A deleted listing is dropped (main CF-0052).
    assert str(kamatis.id) not in lines
    # Totals use the live price.
    assert resp.json()["total_price"] == 60 * 4
    assert resp.json()["total_items"] == 4


def test_previous_price_stays_until_the_next_save(
    db: Session, merchant: Merchant
) -> None:
    user, _ = _buyer(db)
    db.commit()
    talong = _produce(db, merchant, "Talong", price=50)
    client = _client(db, user)
    _put(client, (talong, 1))
    talong.price = 70  # type: ignore[assignment]
    db.commit()

    first = _get(client)[str(talong.id)]
    second = _get(client)[str(talong.id)]  # GET writes the fresh line back

    assert (first["price"], first["previous_price"]) == (70, 50)
    assert (second["price"], second["previous_price"]) == (70, 50)
    saved = _put(client, (talong, 1))[str(talong.id)]
    assert saved["previous_price"] is None
    assert _get(client)[str(talong.id)]["previous_price"] is None


def test_empty_cart(db: Session) -> None:
    user, _ = _buyer(db)
    db.commit()
    resp = _client(db, user).get("/carts/me")
    assert resp.status_code == 200
    assert resp.json()["items"] == [] and resp.json()["total_price"] == 0
