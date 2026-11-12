"""A6: admins hide listings with a reason the merchant can see."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin, admin_audit, admin_produce, merchants
from app.models.admin_audit_log import AdminAuditLog
from app.models.produce import Produce
from app.models.user import User
from tests.test_reviews import _buyer, db, merchant  # noqa: F401 - fixtures


def _client(db, user=None) -> TestClient:
    app = FastAPI()
    for r in (admin.router, admin_audit.router, admin_produce.router, merchants.router):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _staff(db) -> User:
    staff = User(email="admin@example.com", is_admin=True, notifications_preferences={})
    db.add(staff)
    db.commit()
    return staff


def _listing(db, merchant, name="Talong") -> Produce:
    produce = Produce(merchant_id=merchant.id, name=name, price=80, stock_quantity=5)
    db.add(produce)
    db.commit()
    return produce


def _hide(client, produce_id, reason="Misleading photo"):
    return client.post(f"/admin/produce/{produce_id}/hide", json={"reason": reason})


def test_hidden_listing_disappears_for_buyers(db, merchant):
    talong = _listing(db, merchant)
    ampalaya = _listing(db, merchant, "Ampalaya")
    buyers = _client(db)

    res = _hide(_client(db, _staff(db)), talong.id)
    assert res.status_code == 200, res.text
    assert res.json()["hidden_reason"] == "Misleading photo"

    names = [p["name"] for p in buyers.get(f"/merchants/{merchant.id}/produce").json()]
    assert names == ["Ampalaya"]
    listed = buyers.get("/merchants").json()[0]["produces"]
    assert [p["id"] for p in listed] == [ampalaya.id]
    detail = buyers.get(f"/merchants/{merchant.id}").json()["produces"]
    assert [p["id"] for p in detail] == [ampalaya.id]


def test_merchant_still_sees_listing_with_reason(db, merchant):
    talong = _listing(db, merchant)
    _hide(_client(db, _staff(db)), talong.id)
    owner = db.get(User, merchant.user_id)
    mine = _client(db, owner).get("/merchants/me/produce").json()
    assert mine[0]["hidden_reason"] == "Misleading photo"
    assert mine[0]["hidden_at"] is not None


def test_unhide_restores_listing_and_both_are_audited(db, merchant):
    talong = _listing(db, merchant)
    client = _client(db, _staff(db))
    _hide(client, talong.id)
    assert _hide(client, talong.id).status_code == 409

    res = client.post(f"/admin/produce/{talong.id}/unhide")
    assert res.status_code == 200, res.text
    assert res.json()["hidden_at"] is None
    assert client.post(f"/admin/produce/{talong.id}/unhide").status_code == 409
    assert len(_client(db).get(f"/merchants/{merchant.id}/produce").json()) == 1

    actions = [e.action for e in db.query(AdminAuditLog).order_by(AdminAuditLog.id)]
    assert actions == ["produce.hide", "produce.unhide"]


def test_reason_required_and_admin_only(db, merchant):
    talong = _listing(db, merchant)
    client = _client(db, _staff(db))
    assert _hide(client, talong.id, reason="").status_code == 422
    assert _hide(client, talong.id, reason="   ").status_code == 422
    assert _hide(client, 999).status_code == 404

    buyer, _ = _buyer(db)
    nosy = _client(db, buyer)
    assert _hide(nosy, talong.id).status_code == 403
    assert nosy.get("/admin/produce").status_code == 403


def test_admin_lists_and_filters_listings(db, merchant):
    talong = _listing(db, merchant)
    _listing(db, merchant, "Ampalaya")
    client = _client(db, _staff(db))
    _hide(client, talong.id)

    body = client.get("/admin/produce").json()
    assert body["total"] == 2
    assert body["items"][0]["merchant_name"] == "Dela Cruz Farm"
    hidden = client.get("/admin/produce?hidden=true").json()["items"]
    assert [p["name"] for p in hidden] == ["Talong"]
    visible = client.get("/admin/produce?hidden=false").json()["items"]
    assert [p["name"] for p in visible] == ["Ampalaya"]
    assert client.get("/admin/produce?q=ampa").json()["total"] == 1


def test_hidden_listing_cannot_be_ordered(db, merchant):
    from tests.test_produce_freshness import _cart
    from tests.test_produce_freshness import _client as order_client

    talong = _listing(db, merchant)
    _hide(_client(db, _staff(db)), talong.id)
    buyer = _buyer(db)
    _cart(db, buyer, talong)

    resp = order_client(db, buyer[0]).post("/orders/me/place", json={})

    assert resp.status_code == 400
    assert resp.json()["detail"] == "'Talong' is no longer available"
    db.rollback()
    assert db.get(Produce, talong.id).stock_quantity == 5
