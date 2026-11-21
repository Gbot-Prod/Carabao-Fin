"""Mapbox calls the browser used to make with the public token now go through
the API: signed in, rate limited, cached, server token only."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import locations, tracking
from app.services import mapbox_routing, place_search, rate_limit

MALOLOS = (14.8433, 120.8114)

FEATURE = {
    "id": "address.1",
    "place_type": ["address"],
    "text": "Paseo del Congreso",
    "place_name": "Paseo del Congreso, Malolos, Bulacan, Philippines",
    "center": [MALOLOS[1], MALOLOS[0]],
    "context": [
        {"id": "locality.9", "text": "Catmon", "wikidata": "Q1"},
        {"id": "place.7", "text": "Malolos"},
        {"id": "region.3", "text": "Bulacan"},
    ],
    "relevance": 1,
}

LINE = {"type": "LineString", "coordinates": [[120.81, 14.84], [120.82, 14.85]]}


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self.ok = 200 <= status < 300
        self._body = body

    def json(self):
        return self._body


@pytest.fixture(autouse=True)
def _fresh_caches():
    place_search.clear_cache()
    mapbox_routing.clear_route_cache()
    yield
    place_search.clear_cache()
    mapbox_routing.clear_route_cache()


def _fake_get(monkeypatch, module, handler):
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "pk.server-secret")
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append((url, params))
        return handler(url, params)

    monkeypatch.setattr(module._requests, "get", fake_get)
    return calls


def _client(db, user):
    app = FastAPI()
    app.include_router(locations.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


# --- Place search ---------------------------------------------------------------


def test_geocode_returns_trimmed_feature_and_caches(db, buyer, monkeypatch):
    calls = _fake_get(
        monkeypatch, place_search, lambda *_: _Resp(200, {"features": [FEATURE]})
    )
    client = _client(db, buyer[0])
    for query in ("Paseo del Congreso, Malolos", "  paseo del   congreso, MALOLOS "):
        res = client.post("/locations/geocode", json={"query": query})
        assert res.status_code == 200, res.text
    body = res.json()["feature"]
    assert body["center"] == [MALOLOS[1], MALOLOS[0]]
    assert body["context"][0] == {"id": "locality.9", "text": "Catmon"}
    assert "relevance" not in body
    assert "pk.server-secret" not in res.text
    assert len(calls) == 1  # the second (same address, other spacing) is cached
    assert calls[0][1]["country"] == "PH"
    assert calls[0][1]["autocomplete"] == "false"


def test_reverse_geocode_outside_luzon_skips_mapbox(db, buyer, monkeypatch):
    calls = _fake_get(monkeypatch, place_search, lambda *_: _Resp(200, {}))
    client = _client(db, buyer[0])
    res = client.post("/locations/reverse-geocode", json={"lat": 7.07, "lng": 125.61})
    assert res.status_code == 200
    assert res.json() == {"feature": None}
    assert calls == []


def test_reverse_geocode_found_and_not_found(db, buyer, monkeypatch):
    answers = iter([{"features": [FEATURE]}, {"features": []}])
    calls = _fake_get(monkeypatch, place_search, lambda *_: _Resp(200, next(answers)))
    client = _client(db, buyer[0])
    first = client.post(
        "/locations/reverse-geocode", json={"lat": MALOLOS[0], "lng": MALOLOS[1]}
    )
    assert first.json()["feature"]["place_name"].startswith("Paseo")
    empty = client.post("/locations/reverse-geocode", json={"lat": 14.9, "lng": 120.9})
    assert empty.json() == {"feature": None}
    assert len(calls) == 2


def test_outage_is_503_and_not_cached(db, buyer, monkeypatch):
    calls = _fake_get(monkeypatch, place_search, lambda *_: _Resp(500, {}))
    client = _client(db, buyer[0])
    for _ in range(2):
        res = client.post("/locations/geocode", json={"query": "Malolos"})
        assert res.status_code == 503
    assert len(calls) == 2


def test_place_search_is_rate_limited(db, buyer, monkeypatch):
    _fake_get(monkeypatch, place_search, lambda *_: _Resp(200, {"features": []}))
    monkeypatch.setitem(rate_limit.ACTION_LIMITS, "place_search", rate_limit.Limit(2, 3600))
    client = _client(db, buyer[0])
    codes = [
        client.post("/locations/geocode", json={"query": f"street {i}"}).status_code
        for i in range(3)
    ]
    assert codes == [200, 200, 429]


def test_geocode_rejects_long_or_empty_query(db, buyer, monkeypatch):
    calls = _fake_get(monkeypatch, place_search, lambda *_: _Resp(200, {}))
    client = _client(db, buyer[0])
    assert client.post("/locations/geocode", json={"query": ""}).status_code == 422
    assert client.post("/locations/geocode", json={"query": "x" * 300}).status_code == 422
    assert calls == []


# --- Route line -----------------------------------------------------------------


def test_route_geometry_is_cached_per_set_of_stops(monkeypatch):
    calls = _fake_get(
        monkeypatch,
        mapbox_routing,
        lambda *_: _Resp(200, {"routes": [{"geometry": LINE}]}),
    )
    stops = [(14.84, 120.81), (14.85, 120.82)]
    first = mapbox_routing.route_geometry(stops)
    assert first == {"type": "Feature", "properties": {}, "geometry": LINE}
    assert mapbox_routing.route_geometry(stops) == first
    assert len(calls) == 1
    assert calls[0][1]["geometries"] == "geojson"


def test_route_geometry_failure_is_not_cached(monkeypatch):
    calls = _fake_get(monkeypatch, mapbox_routing, lambda *_: _Resp(503, {}))
    stops = [(14.84, 120.81), (14.85, 120.82)]
    assert mapbox_routing.route_geometry(stops) is None
    assert mapbox_routing.route_geometry(stops) is None
    assert len(calls) == 2


def test_route_geometry_skips_too_few_or_too_many_points(monkeypatch):
    calls = _fake_get(monkeypatch, mapbox_routing, lambda *_: _Resp(200, {}))
    assert mapbox_routing.route_geometry([(14.84, 120.81)]) is None
    assert mapbox_routing.route_geometry([(14.84, 120.81)] * 26) is None
    assert calls == []


def test_order_route_uses_only_the_waypoints_the_buyer_sees(monkeypatch):
    seen = []
    monkeypatch.setattr(
        mapbox_routing, "route_geometry", lambda coords: seen.append(coords) or None
    )
    monkeypatch.setattr(rate_limit, "enforce_action", lambda *_: None)
    visible = SimpleNamespace(
        waypoints=[SimpleNamespace(lat=14.8, lng=120.8), SimpleNamespace(lat=14.9, lng=120.9)]
    )
    monkeypatch.setattr(tracking, "get_order_tracking", lambda *_, **__: visible)
    res = tracking.get_order_tracking_route(5, db=None, current_user=SimpleNamespace(id=1))
    assert res.route is None
    assert seen == [[(14.8, 120.8), (14.9, 120.9)]]
