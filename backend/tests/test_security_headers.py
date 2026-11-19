"""CF-0068: every API response carries the security headers; answers to
signed-in requests are never cached."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Response
from fastapi.testclient import TestClient

from app.core.security_headers import API_CSP, SecurityHeadersMiddleware


def _client() -> TestClient:
    app = FastAPI()

    @app.get("/public")
    def public() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/cached")
    def cached(response: Response) -> dict[str, bool]:
        response.headers["Cache-Control"] = "public, max-age=60"
        return {"ok": True}

    @app.get("/boom")
    def boom() -> None:
        raise HTTPException(status_code=404, detail="nope")

    app.add_middleware(SecurityHeadersMiddleware)
    return TestClient(app)


def test_every_response_gets_the_headers() -> None:
    client = _client()
    for path, status in (("/public", 200), ("/boom", 404), ("/missing", 404)):
        res = client.get(path)
        assert res.status_code == status
        assert res.headers["x-content-type-options"] == "nosniff"
        assert res.headers["x-frame-options"] == "DENY"
        assert res.headers["referrer-policy"] == "no-referrer"
        assert res.headers["content-security-policy"] == API_CSP


def test_signed_in_answers_are_not_cached_public_ones_may_be() -> None:
    client = _client()
    assert "cache-control" not in client.get("/public").headers
    for header in ("Authorization", "X-Internal-Auth-Sync-Secret"):
        res = client.get("/public", headers={header: "x"})
        assert res.headers["cache-control"] == "no-store", header


def test_a_route_header_wins() -> None:
    res = _client().get("/cached", headers={"Authorization": "Bearer x"})
    assert res.headers["cache-control"] == "public, max-age=60"
    assert res.headers.get_list("cache-control") == ["public, max-age=60"]


def test_real_app_uses_it_and_dev_docs_keep_working() -> None:
    from main import app

    classes: list[Any] = [m.cls for m in app.user_middleware]
    assert SecurityHeadersMiddleware in classes
    client = TestClient(app)
    res = client.get("/no-such-route", headers={"Authorization": "Bearer x"})
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["cache-control"] == "no-store"
    assert res.headers.get("x-request-id")  # the request-ID middleware still runs
    docs = client.get("/docs")
    if docs.status_code == 200:  # docs are on only in development (CF-0015)
        assert "content-security-policy" not in docs.headers
