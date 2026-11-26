"""Shop page draft and publish.

The merchant edits a draft. Buyers see the live page only, and the farm is
hidden from buyers until the first publish.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants
from app.models.user import User


def _client(db, user_id: int | None) -> TestClient:
    app = FastAPI()
    app.include_router(merchants.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: (
        db.get(User, user_id) if user_id else None
    )
    return TestClient(app)


def _unpublished(db, merchant) -> None:
    """Remove the fixture's published page: the merchant starts with none."""
    db.delete(merchant.shop_page)
    db.commit()
    db.refresh(merchant)


def _public_ids(client: TestClient) -> list[int]:
    return [m["id"] for m in client.get("/merchants").json()]


def test_new_page_is_hidden_until_first_publish(db, merchant):
    _unpublished(db, merchant)
    owner = _client(db, merchant.user_id)
    buyer = _client(db, None)

    res = owner.post(
        "/merchants/me/shoppage",
        json={"title": "Dela Cruz", "slug": "dela-cruz", "description": "Gulay"},
    )
    assert res.status_code == 200, res.text
    page = res.json()
    assert page["is_published"] is False
    assert page["has_unpublished_changes"] is True
    assert page["draft_title"] == "Dela Cruz"

    # Buyers do not see the farm yet.
    assert merchant.id not in _public_ids(buyer)
    assert buyer.get(f"/merchants/{merchant.id}").status_code == 404
    assert buyer.get(f"/merchants/{merchant.id}/shoppage").status_code == 404
    assert buyer.get(f"/merchants/{merchant.id}/produce").status_code == 404

    # The owner still sees the farm and the draft.
    assert owner.get("/merchants/me").json()["id"] == merchant.id
    assert owner.get("/merchants/me/shoppage").json()["draft_description"] == "Gulay"

    # Nothing is live, so there is no live version to go back to.
    assert owner.post("/merchants/me/shoppage/discard").status_code == 400

    res = owner.post("/merchants/me/shoppage/publish")
    assert res.status_code == 200, res.text
    assert res.json()["is_published"] is True
    assert res.json()["has_unpublished_changes"] is False

    assert merchant.id in _public_ids(buyer)
    live = buyer.get(f"/merchants/{merchant.id}/shoppage").json()
    assert live["title"] == "Dela Cruz"
    assert live["description"] == "Gulay"
    assert "draft_title" not in live


def test_edits_stay_in_draft_until_publish(db, merchant):
    owner = _client(db, merchant.user_id)
    buyer = _client(db, None)
    live_title = merchant.shop_page.title

    res = owner.patch(
        "/merchants/me/shoppage", json={"title": "New name", "description": "New"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["draft_title"] == "New name"
    assert res.json()["title"] == live_title
    assert res.json()["has_unpublished_changes"] is True

    # Buyers still see the live page, and the farm stays public.
    live = buyer.get(f"/merchants/{merchant.id}/shoppage").json()
    assert live["title"] == live_title
    assert live["description"] is None
    assert merchant.id in _public_ids(buyer)
    old_name = merchant.merchant_name
    assert buyer.get(f"/merchants/{merchant.id}").json()["merchant_name"] == old_name

    owner.post("/merchants/me/shoppage/publish")
    live = buyer.get(f"/merchants/{merchant.id}/shoppage").json()
    assert live["title"] == "New name"
    assert live["description"] == "New"
    # Publish makes the title the store name that buyers see.
    assert buyer.get(f"/merchants/{merchant.id}").json()["merchant_name"] == "New name"


def test_discard_restores_the_live_page(db, merchant):
    owner = _client(db, merchant.user_id)
    live_title = merchant.shop_page.title

    owner.patch("/merchants/me/shoppage", json={"title": "Draft", "logo_url": ""})
    res = owner.post("/merchants/me/shoppage/discard")
    assert res.status_code == 200, res.text
    assert res.json()["draft_title"] == live_title
    assert res.json()["has_unpublished_changes"] is False


def test_title_cannot_be_blank(db, merchant):
    owner = _client(db, merchant.user_id)
    assert (
        owner.patch("/merchants/me/shoppage", json={"title": "  "}).status_code == 422
    )


def test_uploaded_image_goes_to_draft(db, merchant, monkeypatch):
    from app.services import r2_service

    monkeypatch.setattr(
        r2_service, "upload_shop_logo", lambda _id, _f: "https://cdn.test/logo-2.png"
    )
    monkeypatch.setattr(
        merchants.upload_validation,
        "check_image_upload",
        lambda file, label: file,
    )
    owner = _client(db, merchant.user_id)
    res = owner.post(
        "/merchants/me/shoppage/logo",
        files={"logo": ("logo.png", b"x", "image/png")},
    )
    assert res.status_code == 200, res.text
    assert res.json()["draft_logo_url"] == "https://cdn.test/logo-2.png"
    assert res.json()["logo_url"] is None


def test_unpublish_hides_the_shop_until_publish(db, merchant):
    owner = _client(db, merchant.user_id)
    buyer = _client(db, None)
    owner.patch("/merchants/me/shoppage", json={"description": "Draft text"})

    res = owner.post("/merchants/me/shoppage/unpublish")
    assert res.status_code == 200, res.text
    page = res.json()
    assert page["is_published"] is False
    assert page["published_at"] is None
    # The draft stays.
    assert page["draft_description"] == "Draft text"

    # Buyers do not see the farm.
    assert merchant.id not in _public_ids(buyer)
    assert buyer.get(f"/merchants/{merchant.id}/shoppage").status_code == 404
    # The owner still sees it.
    assert owner.get("/merchants/me").json()["id"] == merchant.id

    # A second unpublish is refused.
    assert owner.post("/merchants/me/shoppage/unpublish").status_code == 400

    res = owner.post("/merchants/me/shoppage/publish")
    assert res.status_code == 200, res.text
    assert res.json()["is_published"] is True
    assert merchant.id in _public_ids(buyer)
    assert (
        buyer.get(f"/merchants/{merchant.id}/shoppage").json()["description"]
        == "Draft text"
    )
