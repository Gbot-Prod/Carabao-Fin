"""Server-side PSGC check of region -> province -> city -> barangay."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders, user_addresses
from app.models.cart import Cart
from app.models.order import Order
from app.models.produce import Produce
from app.models.psgc_area import PsgcArea
from app.models.user_address import UserAddress
from app.services import psgc
from app.services.psgc import AreaError, check_postal_code, name_key, resolve_area
from tests.better_auth import make_user
from tests.psgc_rows import MALOLOS


def _client(db, user) -> TestClient:
    app = FastAPI()
    app.include_router(user_addresses.router)
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


# --- resolve_area ---------------------------------------------------------------


def test_names_resolve_to_codes_and_psgc_names(db):
    area = resolve_area(
        db,
        {
            "region": "region iii",
            "province": "BULACAN",
            "city": "city of  malolos",
            "barangay": "poblacion",
        },
    )
    assert area.region == "Region III (Central Luzon)"
    assert area.city == "City of Malolos"
    assert (area.region_code, area.province_code, area.city_code) == (
        "0300000000",
        "0301400000",
        "0301410000",
    )
    assert area.barangay_code == "0301410001"
    assert area.postal_code == "3000"
    assert area.in_luzon


def test_codes_win_over_names(db):
    area = resolve_area(
        db,
        {
            "region": "anything",
            "region_code": "0300000000",
            "province_code": "0301400000",
            "city_code": "0301409000",
            "barangay_code": "0301409002",
        },
    )
    assert (area.city, area.barangay) == ("Hagonoy", "Santo Niño")


@pytest.mark.parametrize(
    ("values", "field"),
    [
        # Benguet is in CAR, not Region III.
        ({**MALOLOS, "province": "Benguet"}, "province"),
        # Cebu City is not in Bulacan.
        ({**MALOLOS, "city": "Cebu City"}, "city"),
        # Lahug is not in Malolos.
        ({**MALOLOS, "barangay": "Lahug"}, "barangay"),
        # A code whose parent is another place.
        ({**MALOLOS, "city": None, "city_code": "1430300000"}, "city"),
        ({**MALOLOS, "barangay": None}, "barangay"),
        ({**MALOLOS, "city": None}, "city"),
        ({**MALOLOS, "region": "Region 99"}, "region"),
    ],
)
def test_a_broken_chain_is_refused(db, values, field):
    with pytest.raises(AreaError) as err:
        resolve_area(db, values)
    assert err.value.field == field


@pytest.mark.parametrize(
    "values",
    [
        {
            "region": "Region VII (Central Visayas)",
            "province": "Cebu",
            "city": "Cebu City",
            "barangay": "Lahug",
        },
        {
            "region": "MIMAROPA Region",
            "province": "Oriental Mindoro",
            "city": "City of Calapan",
            "barangay": "Lalud",
        },
        # The region comes from the code, not from the sent name.
        {"region": "NCR", "region_code": "0700000000", "province": "Cebu"},
    ],
)
def test_outside_luzon_is_refused(db, values):
    with pytest.raises(AreaError) as err:
        resolve_area(db, values)
    assert err.value.field == "region"
    assert "Luzon" in err.value.message


def test_ncr_has_metro_manila_and_no_province(db):
    for province in ("Metro Manila", "", None):
        area = resolve_area(
            db,
            {
                "region": "NCR",
                "province": province,
                "city": "City of Las Pinas",
                "barangay": "Almanza Uno",
            },
        )
        assert area.province == "Metro Manila"
        assert area.province_code is None
        assert area.city == "City of Las Piñas"
    with pytest.raises(AreaError):
        resolve_area(
            db, {"region": "NCR", "province": "Bulacan", "city": "Quezon City"}
        )


def test_a_city_with_no_barangays_takes_none(db):
    area = resolve_area(db, {"region": "NCR", "city": "City of Manila"})
    assert area.barangay is None
    with pytest.raises(AreaError) as err:
        resolve_area(db, {"region": "NCR", "city": "City of Manila", "barangay": "X"})
    assert err.value.field == "barangay"


def test_the_same_city_name_in_two_provinces(db):
    # "Hagonoy" is in Bulacan and in Davao del Sur: the province decides.
    area = resolve_area(db, {**MALOLOS, "city": "Hagonoy", "barangay": "San Isidro"})
    assert area.city_code == "0301409000"


def test_postal_code_is_checked_and_filled(db):
    area = resolve_area(db, MALOLOS)
    assert check_postal_code(None, area) == "3000"
    assert check_postal_code(" 3001 ", area) == "3001"  # not compared with the city
    for bad in ("300", "30000", "ABCD"):
        with pytest.raises(AreaError):
            check_postal_code(bad, area)


def test_an_empty_list_answers_503(db):
    db.query(PsgcArea).delete()
    db.commit()
    with pytest.raises(psgc.AreaListMissing):
        resolve_area(db, MALOLOS)


def test_name_key():
    assert name_key("  City of Las Piñas ") == name_key("city of las pinas")
    assert name_key("Tondo I/II") == "tondo i ii"


def test_seed_file_loads(db):
    path = Path(psgc.SEED_FILE)
    if not path.exists():
        pytest.skip("app/data/psgc.csv not generated")
    rows = psgc.read_rows(path)
    codes = {r["code"] for r in rows}
    assert all(r["parent_code"] in codes for r in rows if r["parent_code"])
    assert {r["code"] for r in rows if r["level"] == "region"} >= set(
        psgc.LUZON_REGION_CODES
    )


# --- saved addresses ------------------------------------------------------------


def test_saved_address_stores_psgc_names_and_codes(db, buyer):  # noqa: F811
    me = _client(db, buyer[0])
    resp = me.post(
        "/users/me/addresses",
        json={**MALOLOS, "city": "city of malolos", "address": "12 Mabini St"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["city"] == "City of Malolos"
    assert body["city_code"] == "0301410000"
    assert body["postal_code"] == "3000"


def test_saved_address_outside_luzon_or_mixed_is_refused(db, buyer):  # noqa: F811
    me = _client(db, buyer[0])
    mixed = me.post(
        "/users/me/addresses",
        json={"region": "NCR", "province": "Benguet", "city": "Cebu City"},
    )
    assert mixed.status_code == 400
    cebu = me.post(
        "/users/me/addresses",
        json={
            "region": "Region VII (Central Visayas)",
            "province": "Cebu",
            "city": "Cebu City",
            "barangay": "Lahug",
        },
    )
    assert cebu.status_code == 400 and "Luzon" in cebu.json()["detail"]
    assert db.query(UserAddress).count() == 0


def test_patch_checks_the_merged_chain(db, buyer):  # noqa: F811
    me = _client(db, buyer[0])
    saved = me.post("/users/me/addresses", json=MALOLOS).json()
    # Only the barangay changes; the rest comes from the saved row.
    ok = me.patch(f"/users/me/addresses/{saved['id']}", json={"barangay": "San Isidro"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["barangay_code"] == "0301410002"
    # A city from another province is refused.
    bad = me.patch(f"/users/me/addresses/{saved['id']}", json={"city": "Cebu City"})
    assert bad.status_code == 400
    bad_postal = me.patch(
        f"/users/me/addresses/{saved['id']}", json={"postal_code": "12"}
    )
    assert bad_postal.status_code == 400


def test_address_with_no_area_is_still_allowed(db, buyer):  # noqa: F811
    me = _client(db, buyer[0])
    resp = me.post("/users/me/addresses", json={"label": "Pin only"})
    assert resp.status_code == 201
    assert resp.json()["region_code"] is None


def test_bad_code_format_is_422(db, buyer):  # noqa: F811
    me = _client(db, buyer[0])
    resp = me.post("/users/me/addresses", json={**MALOLOS, "city_code": "12"})
    assert resp.status_code == 422


# --- checkout with a saved address ----------------------------------------------


def _cart(db, buyer, merchant):  # noqa: F811
    produce = Produce(
        merchant_id=merchant.id, name="Talong", price=50, stock_quantity=9
    )
    db.add(produce)
    db.flush()
    db.add(Cart(user_id=buyer[0].id, items=[{"produce_id": produce.id, "quantity": 1}]))
    db.commit()


def test_checkout_takes_the_address_from_the_saved_row(db, merchant, buyer):  # noqa: F811
    _cart(db, buyer, merchant)
    me = _client(db, buyer[0])
    saved = me.post(
        "/users/me/addresses", json={**MALOLOS, "address": "12 Mabini St"}
    ).json()
    resp = me.post("/orders/me/place", json={"delivery_address_id": saved["id"]})
    assert resp.status_code == 200, resp.text
    order = db.query(Order).one()
    assert order.delivery_address == (
        "12 Mabini St, Poblacion, City of Malolos, Bulacan, 3000"
    )


def test_checkout_saved_address_refuses_extra_fields(db, merchant, buyer):  # noqa: F811
    _cart(db, buyer, merchant)
    me = _client(db, buyer[0])
    saved = me.post("/users/me/addresses", json=MALOLOS).json()
    resp = me.post(
        "/orders/me/place",
        json={"delivery_address_id": saved["id"], "delivery_region": "NCR"},
    )
    assert resp.status_code == 422
    assert db.query(Order).count() == 0


def test_checkout_saved_address_must_be_own_and_have_an_area(db, merchant, buyer):  # noqa: F811
    _cart(db, buyer, merchant)
    other = make_user(db, "other@example.com")
    db.add(other)
    db.flush()
    theirs = UserAddress(user_id=other.id, is_default=True, **MALOLOS)
    db.add(theirs)
    db.commit()
    me = _client(db, buyer[0])
    assert (
        me.post("/orders/me/place", json={"delivery_address_id": theirs.id}).status_code
        == 404
    )
    pin_only = me.post("/users/me/addresses", json={"label": "Pin"}).json()
    resp = me.post("/orders/me/place", json={"delivery_address_id": pin_only["id"]})
    assert resp.status_code == 400
