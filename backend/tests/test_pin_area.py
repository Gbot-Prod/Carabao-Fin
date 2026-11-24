"""Item 2: the server compares an address pin with its city/barangay polygons."""

import gzip
import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import user_addresses
from app.services import pin_area
from tests.psgc_rows import MALOLOS

MALOLOS_CODE = "0301410000"
POBLACION_CODE = "0301410001"

# Squares, not the real shapes: Malolos 14.80-14.90 N, 120.75-120.85 E;
# Poblacion 14.84-14.85 N, 120.80-120.81 E.
IN_POBLACION = (14.845, 120.805)
IN_MALOLOS_ONLY = (14.82, 120.77)
NEAR_MALOLOS = (14.91, 120.80)  # about 1.1 km north of the city line
FAR_FROM_MALOLOS = (15.10, 120.80)  # about 22 km north


def _square(lat0: float, lat1: float, lng0: float, lng1: float) -> dict:
    ring = [[lng0, lat0], [lng1, lat0], [lng1, lat1], [lng0, lat1], [lng0, lat0]]
    return {"type": "Polygon", "coordinates": [ring]}


@pytest.fixture
def shapes(db, tmp_path):
    path = tmp_path / "boundaries.jsonl.gz"
    city = _square(14.8, 14.9, 120.75, 120.85)
    barangay = _square(14.84, 14.85, 120.8, 120.81)
    rows = [
        {"code": MALOLOS_CODE, "level": "city", "geometry": city},
        {"code": POBLACION_CODE, "level": "barangay", "geometry": barangay},
    ]
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        fh.writelines(json.dumps(row) + "\n" for row in rows)
    assert pin_area.load(db, path) == 2
    return db


def _client(db, user) -> TestClient:
    app = FastAPI()
    app.include_router(user_addresses.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.mark.parametrize(
    ("pin", "barangay", "expected"),
    [
        (IN_POBLACION, POBLACION_CODE, False),
        (IN_MALOLOS_ONLY, None, False),
        (IN_MALOLOS_ONLY, POBLACION_CODE, True),  # in the city, not the barangay
        (NEAR_MALOLOS, None, True),  # over the city line, kept with the flag
        (None, POBLACION_CODE, None),  # no pin: not checked
    ],
)
def test_check(shapes, pin, barangay, expected):
    assert pin_area.check(shapes, pin, MALOLOS_CODE, barangay) is expected


def test_city_without_a_shape_is_not_checked(shapes):
    assert pin_area.check(shapes, FAR_FROM_MALOLOS, "0301409000", None) is None


def test_far_pin_is_refused(shapes):
    with pytest.raises(HTTPException) as info:
        pin_area.check(shapes, FAR_FROM_MALOLOS, MALOLOS_CODE, None)
    assert info.value.status_code == 400
    assert "km outside City of Malolos" in info.value.detail


def test_saved_address_gets_the_flag_and_far_moves_are_refused(shapes, buyer):
    me = _client(shapes, buyer[0])
    lat, lng = IN_POBLACION
    made = me.post("/users/me/addresses", json={**MALOLOS, "lat": lat, "lng": lng})
    assert made.status_code == 201, made.text
    assert made.json()["pin_area_mismatch"] is False
    url = f"/users/me/addresses/{made.json()['id']}"

    lat, lng = NEAR_MALOLOS
    moved = me.patch(url, json={"lat": lat, "lng": lng})
    assert moved.status_code == 200, moved.text
    assert moved.json()["pin_area_mismatch"] is True

    lat, lng = FAR_FROM_MALOLOS
    refused = me.patch(url, json={"lat": lat, "lng": lng})
    assert refused.status_code == 400
    assert "km outside City of Malolos" in refused.json()["detail"]
