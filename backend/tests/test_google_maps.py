"""Google Maps Platform provider: the switches and the answer shapes."""

from __future__ import annotations

import pytest

from app.services import (
    google_maps,
    mapbox_routing,
    maps_provider,
    place_search,
    road_snap,
)


class _Resp:
    def __init__(self, status: int, body):
        self.status_code = status
        self.ok = 200 <= status < 300
        self._body = body

    def json(self):
        return self._body


@pytest.fixture(autouse=True)
def _google(monkeypatch):
    monkeypatch.setenv("MAPS_PLATFORM_API_KEY", "g-secret")
    monkeypatch.delenv("ROAD_SNAP_PROVIDER", raising=False)
    place_search.clear_cache()
    road_snap.clear_cache()
    mapbox_routing.clear_route_cache()
    yield
    place_search.clear_cache()
    road_snap.clear_cache()
    mapbox_routing.clear_route_cache()


def test_switches(monkeypatch):
    assert maps_provider.routing_provider() == "google"
    assert road_snap.provider() == "google"
    monkeypatch.setenv("MAPS_PROVIDER", "mapbox")
    assert maps_provider.geocode_provider() == "mapbox"
    # No Mapbox token: the road check is off, not sent to Google.
    assert road_snap.provider() == "off"
    monkeypatch.setenv("ROUTING_PROVIDER", "google")
    assert maps_provider.routing_provider() == "google"
    assert maps_provider.geocode_provider() == "mapbox"


def test_matrix_is_tiled_and_parsed(monkeypatch):
    calls = []

    def fake_post(url, json, headers, timeout):
        calls.append((len(json["origins"]), len(json["destinations"])))
        assert headers["X-Goog-Api-Key"] == "g-secret"
        elements = [
            {
                "originIndex": i,
                "destinationIndex": j,
                "duration": "60s",
                "condition": "ROUTE_EXISTS",
            }
            for i in range(len(json["origins"]))
            for j in range(len(json["destinations"]))
        ]
        # Proto3 JSON leaves out a zero index; one pair has no route.
        del elements[1]["originIndex"]
        elements[2]["condition"] = "ROUTE_NOT_FOUND"
        return _Resp(200, elements)

    monkeypatch.setattr(google_maps._requests, "post", fake_post)
    coords = [(14.5 + i * 0.01, 121.0) for i in range(30)]
    matrix = mapbox_routing.duration_matrix(coords)
    assert sorted(calls) == [(5, 5), (5, 25), (25, 5), (25, 25)]
    assert matrix is not None and len(matrix) == 30
    assert matrix[0][0] == 0.0 and matrix[0][1] == 60.0 and matrix[0][2] is None


def test_matrix_failure_is_none(monkeypatch):
    monkeypatch.setattr(google_maps._requests, "post", lambda *a, **k: _Resp(403, {}))
    assert mapbox_routing.duration_matrix([(14.5, 121.0), (14.6, 121.0)]) is None


def test_route_geometry_and_leg_durations(monkeypatch):
    line = {"type": "LineString", "coordinates": [[121.0, 14.5], [121.0, 14.6]]}

    def fake_post(url, json, headers, timeout):
        if "polyline" in headers["X-Goog-FieldMask"]:
            return _Resp(200, {"routes": [{"polyline": {"geoJsonLinestring": line}}]})
        legs = [{"duration": "100s"}] * (len(json["intermediates"]) + 1)
        return _Resp(200, {"routes": [{"legs": legs}]})

    monkeypatch.setattr(google_maps._requests, "post", fake_post)
    feature = mapbox_routing.route_geometry([(14.5, 121.0), (14.6, 121.0)])
    assert feature == {"type": "Feature", "properties": {}, "geometry": line}
    # 30 points: two requests (27 + 4 points), 29 legs.
    legs = mapbox_routing.leg_durations([(14.5 + i * 0.01, 121.0) for i in range(30)])
    assert legs is not None and len(legs) == 29 and legs[-1] == 2900.0


def test_geocode_gives_mapbox_feature_shape(monkeypatch):
    result = {
        "place_id": "abc",
        "types": ["street_address"],
        "formatted_address": "1 Rizal St, Malolos, Bulacan, Philippines",
        "geometry": {"location": {"lat": 14.84, "lng": 120.81}},
        "address_components": [
            {"long_name": "1", "types": ["street_number"]},
            {
                "long_name": "Santo Rosario",
                "types": ["sublocality_level_1", "sublocality"],
            },
            {"long_name": "Malolos", "types": ["locality", "political"]},
            {"long_name": "Bulacan", "types": ["administrative_area_level_2"]},
            {"long_name": "Central Luzon", "types": ["administrative_area_level_1"]},
        ],
    }
    seen = []

    def fake_get(url, params, timeout):
        seen.append(params)
        return _Resp(200, {"status": "OK", "results": [result]})

    monkeypatch.setattr(google_maps._requests, "get", fake_get)
    feature = place_search.forward("1 Rizal St Malolos")
    assert seen[0]["components"] == "country:PH" and seen[0]["key"] == "g-secret"
    assert feature["place_type"] == ["address"] and feature["center"] == [120.81, 14.84]
    assert [c["id"].split(".")[0] for c in feature["context"]] == [
        "locality",
        "place",
        "region",
        "district",
    ]


def test_geocode_outage_raises(monkeypatch):
    monkeypatch.setattr(
        google_maps._requests,
        "get",
        lambda *a, **k: _Resp(200, {"status": "REQUEST_DENIED"}),
    )
    with pytest.raises(place_search.PlaceSearchUnavailable):
        place_search.forward("Malolos")


def test_road_snap(monkeypatch):
    answers = iter(
        [
            {
                "snappedPoints": [
                    {"location": {"latitude": 14.8401, "longitude": 120.81}}
                ]
            },
            {},
        ]
    )
    monkeypatch.setattr(
        google_maps._requests, "get", lambda *a, **k: _Resp(200, next(answers))
    )
    snap = road_snap.snap_to_road(14.84, 120.81)
    assert isinstance(snap, road_snap.Snap) and 10 < snap.distance_m < 12
    assert road_snap.snap_to_road(15.0, 121.0) is road_snap.NO_ROAD


def test_street_suggestions_then_place(monkeypatch):
    def fake_post(url, json, headers, timeout):
        assert json["includedRegionCodes"] == ["ph"] and json["sessionToken"] == "s1"
        prediction = {
            "placeId": "pid1",
            "structuredFormat": {
                "mainText": {"text": "1 Rizal St"},
                "secondaryText": {"text": "Malolos, Bulacan"},
            },
        }
        return _Resp(200, {"suggestions": [{"placePrediction": prediction}]})

    def fake_get(url, params, headers, timeout):
        assert url.endswith("/places/pid1") and params["sessionToken"] == "s1"
        return _Resp(
            200,
            {
                "id": "pid1",
                "types": ["street_address"],
                "formattedAddress": "1 Rizal St, Malolos, Bulacan",
                "location": {"latitude": 14.84, "longitude": 120.81},
                "addressComponents": [
                    {"longText": "Malolos", "types": ["locality"]},
                ],
            },
        )

    monkeypatch.setattr(google_maps._requests, "post", fake_post)
    monkeypatch.setattr(google_maps._requests, "get", fake_get)
    assert place_search.suggest("1 Rizal St, Malolos", "s1") == [
        {
            "id": "pid1",
            "title": "1 Rizal St",
            "subtitle": "Malolos, Bulacan",
            "center": None,
        }
    ]
    feature = place_search.place("pid1", "s1")
    assert feature["center"] == [120.81, 14.84] and feature["place_type"] == ["address"]
