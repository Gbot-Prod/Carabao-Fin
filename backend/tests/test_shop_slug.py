"""Shop slugs in farm links (/farms/<slug>).

GET /shops/{slug} tells the web page which farm a slug names. An old slug
still finds the farm (the page redirects to the current one), a current slug
wins over another shop's old one, and a slug of only digits is refused
because /farms/<number> is a farm id.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants
from app.models.merchant import Merchant
from app.models.shopPage import ShopSlugHistory
from app.models.user import User
from tests.better_auth import make_user
from tests.shared_fixtures import publish_shop_page


def _client(db, user_id: int | None) -> TestClient:
    app = FastAPI()
    app.include_router(merchants.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: (
        db.get(User, user_id) if user_id else None
    )
    return TestClient(app)


def _other_merchant(db) -> Merchant:
    owner = make_user(db, "other@example.com")
    db.add(owner)
    db.flush()
    other = Merchant(
        verification_status="verified",
        user_id=owner.id,
        merchant_name="Santos Farm",
        contact_number="639171234568",
        region="Region III",
        province="Bulacan",
        address="Purok 2",
        postal_code="3000",
        available_days=["mon"],
        operating_hours={},
        seller_type="individual_farmer",
        rsbsa_document_path="rsbsa/2.pdf",
        gov_id_type="Passport",
        gov_id_document_path="gov-id/y.pdf",
    )
    db.add(other)
    db.flush()
    publish_shop_page(db, other)
    db.commit()
    return other


def _rename(client: TestClient, slug: str):
    return client.patch("/merchants/me/shoppage", json={"slug": slug})


def test_current_slug_finds_the_farm(db, merchant):
    buyer = _client(db, None)
    res = buyer.get(f"/shops/{merchant.shop_page.slug}")
    assert res.status_code == 200, res.text
    assert res.json() == {"merchant_id": merchant.id, "slug": merchant.shop_page.slug}


def test_lookup_ignores_case(db, merchant):
    res = _client(db, None).get(f"/shops/{merchant.shop_page.slug.upper()}")
    assert res.status_code == 200
    assert res.json()["slug"] == merchant.shop_page.slug


def test_unknown_slug_is_404(db, merchant):
    assert _client(db, None).get("/shops/no-such-farm").status_code == 404


def test_old_slug_still_finds_the_farm_with_the_new_slug(db, merchant):
    owner = _client(db, merchant.user_id)
    old = merchant.shop_page.slug
    assert _rename(owner, "dela-cruz-gulay").status_code == 200

    res = _client(db, None).get(f"/shops/{old}")
    assert res.status_code == 200, res.text
    assert res.json() == {"merchant_id": merchant.id, "slug": "dela-cruz-gulay"}


def test_renaming_back_and_forth_keeps_every_link(db, merchant):
    owner = _client(db, merchant.user_id)
    first = merchant.shop_page.slug
    _rename(owner, "second-name")
    _rename(owner, "third-name")
    _rename(owner, first)

    buyer = _client(db, None)
    for slug in (first, "second-name", "third-name"):
        assert buyer.get(f"/shops/{slug}").json() == {
            "merchant_id": merchant.id,
            "slug": first,
        }
    # The current slug is not also kept as an old one.
    assert db.query(ShopSlugHistory).filter_by(slug=first).count() == 0


def test_same_slug_again_adds_no_history(db, merchant):
    owner = _client(db, merchant.user_id)
    assert _rename(owner, merchant.shop_page.slug).status_code == 200
    assert db.query(ShopSlugHistory).count() == 0


def test_another_shop_can_take_an_old_slug(db, merchant):
    owner = _client(db, merchant.user_id)
    old = merchant.shop_page.slug
    _rename(owner, "dela-cruz-gulay")

    other = _other_merchant(db)
    assert _rename(_client(db, other.user_id), old).status_code == 200

    # The old slug now names the other shop, not a redirect to the first.
    res = _client(db, None).get(f"/shops/{old}")
    assert res.json() == {"merchant_id": other.id, "slug": old}


def test_a_current_slug_still_cannot_be_taken(db, merchant):
    other = _other_merchant(db)
    res = _rename(_client(db, other.user_id), merchant.shop_page.slug)
    assert res.status_code == 400


def test_hidden_farm_is_404_by_current_and_old_slug(db, merchant):
    owner = _client(db, merchant.user_id)
    old = merchant.shop_page.slug
    _rename(owner, "dela-cruz-gulay")
    owner.post("/merchants/me/shoppage/unpublish")

    buyer = _client(db, None)
    assert buyer.get("/shops/dela-cruz-gulay").status_code == 404
    assert buyer.get(f"/shops/{old}").status_code == 404


def test_slug_of_only_digits_is_refused(db, merchant):
    owner = _client(db, merchant.user_id)
    assert _rename(owner, "12345").status_code == 422
    # Digits with a letter or a hyphenated word are fine.
    assert _rename(owner, "farm-12345").status_code == 200


def test_overlong_slug_lookup_is_refused(db, merchant):
    assert _client(db, None).get("/shops/" + "a" * 200).status_code == 422
