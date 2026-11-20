"""CF-0093: every `page` query param has an upper bound.

The offset is (page - 1) * page_size, so an unbounded page gave a 500 on
Postgres (bigint out of range) and deep table scans, also on the public
produce search. CF-0059 bounded the `offset` params only.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_db
from app.api.routes import produce_search
from app.api.routes.router import router as api_router
from app.schemas.pagination import MAX_PAGE


def _all_routes_app() -> FastAPI:
    """The same routes as main.py, without its startup checks."""
    app = FastAPI()
    app.include_router(api_router)
    return app


def test_every_page_param_is_bounded():
    """CF-0093: no route takes `page` without `le=MAX_PAGE` (or lower)."""
    schema = _all_routes_app().openapi()
    seen = []
    for path, methods in schema["paths"].items():
        for method, op in methods.items():
            for param in op.get("parameters", []):
                if param["name"] != "page" or param["in"] != "query":
                    continue
                seen.append(f"{method.upper()} {path}")
                maximum = param["schema"].get("maximum")
                assert maximum is not None, f"{method.upper()} {path}: page unbounded"
                assert maximum <= MAX_PAGE, f"{method.upper()} {path}: page ≤ {maximum}"
    # The guard must see the paged routes, or it checks nothing.
    assert "GET /produce/search" in seen
    assert len(seen) >= 8


def test_public_search_refuses_a_huge_page(db):
    """CF-0093: the public search answers 422, not a 500 from the database."""
    app = FastAPI()
    app.include_router(produce_search.router)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    def status(page: int) -> int:
        return client.get("/produce/search", params={"page": page}).status_code

    assert status(MAX_PAGE + 1) == 422
    assert status(10**30) == 422
    assert status(MAX_PAGE) == 200
