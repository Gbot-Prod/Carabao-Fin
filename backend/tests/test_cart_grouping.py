"""C1b: saving the cart tags each line with its merchant and delivery fee."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import carts
from app.models.produce import Produce
from tests.test_merchant_listings import _other_merchant
from tests.test_reviews import buyer, db, merchant  # noqa: F401 - fixtures


def test_saved_cart_lines_carry_merchant_and_delivery_fee(db, merchant, buyer):  # noqa: F811
    rival = _other_merchant(db)
    merchant.delivery_price = 40
    rival.delivery_price = None
    talong = Produce(merchant_id=merchant.id, name="Talong", price=50, stock_quantity=9)
    mangga = Produce(merchant_id=rival.id, name="Mangga", price=99, stock_quantity=9)
    db.add_all([talong, mangga])
    db.commit()

    app = FastAPI()
    app.include_router(carts.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: buyer[0]
    client = TestClient(app)

    resp = client.put(
        "/carts/me",
        json={
            "items": [
                {"id": str(talong.id), "farm": "stale name", "quantity": 2},
                {"id": str(mangga.id), "quantity": 1},
            ]
        },
    )

    assert resp.status_code == 200, resp.text
    lines = {i["id"]: i for i in resp.json()["items"]}
    assert lines[str(talong.id)]["merchant_id"] == merchant.id
    assert lines[str(talong.id)]["farm"] == "Dela Cruz Farm"
    assert lines[str(talong.id)]["delivery_fee"] == 40
    assert lines[str(mangga.id)]["merchant_id"] == rival.id
    assert lines[str(mangga.id)]["delivery_fee"] == 0
    # Read back on GET as stored.
    again = {i["id"]: i for i in client.get("/carts/me").json()["items"]}
    assert again[str(mangga.id)]["farm"] == "Other Farm"


def test_cart_needs_a_signed_in_buyer(db):  # noqa: F811
    # E4: the cart lives on the account, which is why clients ask a signed-out
    # buyer to sign in before adding produce.
    app = FastAPI()
    app.include_router(carts.router)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    assert client.get("/carts/me").status_code == 401
    assert client.put("/carts/me", json={"items": []}).status_code == 401
