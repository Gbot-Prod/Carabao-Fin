"""CF-0022: request bodies above the limit get a 413 before they are parsed."""

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.core.body_limit import DEFAULT_MAX_BODY, PATH_LIMITS, BodySizeLimitMiddleware

LIMIT = 100


def _client() -> TestClient:
    app = FastAPI()

    @app.post("/echo")
    async def echo(request: Request):
        return {"size": len(await request.body())}

    @app.post("/big")
    async def big(request: Request):
        return {"size": len(await request.body())}

    app.add_middleware(
        BodySizeLimitMiddleware, default_limit=LIMIT, path_limits={"/big": LIMIT * 2}
    )
    return TestClient(app)


def test_body_at_the_limit_is_accepted():
    resp = _client().post("/echo", content=b"x" * LIMIT)
    assert resp.status_code == 200
    assert resp.json() == {"size": LIMIT}


def test_declared_length_above_the_limit_is_refused():
    resp = _client().post("/echo", content=b"x" * (LIMIT + 1))
    assert resp.status_code == 413
    assert "under" in resp.json()["detail"]


def test_chunked_body_above_the_limit_is_refused():
    # No Content-Length: the bytes are counted as they arrive.
    chunks = (b"x" * 40 for _ in range(4))
    resp = _client().post("/echo", content=chunks)
    assert resp.status_code == 413


def test_path_limit_overrides_the_default():
    client = _client()
    assert client.post("/big", content=b"x" * (LIMIT * 2)).status_code == 200
    assert client.post("/big", content=b"x" * (LIMIT * 2 + 1)).status_code == 413


def test_real_app_limits():
    from main import app

    middleware = [m for m in app.user_middleware if m.cls is BodySizeLimitMiddleware]
    assert middleware, "main.py adds BodySizeLimitMiddleware"
    # The RSBSA upload (20 MB) fits; everything else uses the default.
    assert PATH_LIMITS["/merchant-onboarding/me"] > 20 * 1024 * 1024
    assert DEFAULT_MAX_BODY < PATH_LIMITS["/merchant-onboarding/me"]
