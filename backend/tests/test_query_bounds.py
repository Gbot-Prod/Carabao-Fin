"""CF-0094 (B102, B101): every query param has an upper bound.

CF-0059 bounded `offset` and CF-0093 `page`; this walk covers the rest: every
integer has a maximum, every free string a max length, every list a max
item count with bounded items. Plus the per-IP limit on the public
reference-price match (B101).
"""

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.routes import produce_search
from app.api.routes import reference_prices as reference_routes
from app.api.routes.router import router as api_router
from app.schemas.produce import MAX_PRICE
from app.services import rate_limit, reference_prices


def _unbounded(schema: dict[str, Any]) -> str | None:
    """Why this param schema has no upper bound, or None when it has one."""
    for alt in schema.get("anyOf", [schema]):
        kind = alt.get("type")
        if kind == "integer" or kind == "number":
            if "maximum" not in alt and "exclusiveMaximum" not in alt:
                return f"{kind} with no maximum"
        elif kind == "string":
            if not ({"maxLength", "enum", "format", "const"} & alt.keys()):
                return "string with no maxLength"
        elif kind == "array":
            if "maxItems" not in alt:
                return "list with no maxItems"
            if reason := _unbounded(alt.get("items", {})):
                return f"list item: {reason}"
    return None


def test_every_query_param_is_bounded() -> None:
    """CF-0094: no route takes an int, string or list query param with no limit."""
    app = FastAPI()
    app.include_router(api_router)
    problems: list[str] = []
    checked = 0
    for path, methods in app.openapi()["paths"].items():
        for method, op in methods.items():
            for param in op.get("parameters", []):
                if param["in"] != "query":
                    continue
                checked += 1
                if reason := _unbounded(param["schema"]):
                    where = f"{method.upper()} {path} {param['name']}"
                    problems.append(f"{where}: {reason}")
    assert problems == []
    # The guard must see the query params, or it checks nothing.
    assert checked >= 60


def _search_client(db: Session) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(produce_search.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_search_price_filters_are_bounded(db: Session) -> None:  # noqa: F811
    """CF-0094: a price filter above any listing price is a 422, not a query."""
    client = _search_client(db)
    for name in ("min_price", "max_price"):
        at_cap = client.get("/produce/search", params={name: MAX_PRICE})
        assert at_cap.status_code == 200
        too_big = client.get("/produce/search", params={name: MAX_PRICE + 1})
        assert too_big.status_code == 422
        assert client.get("/produce/search", params={name: 10**30}).status_code == 422


def test_reference_price_match_is_limited_per_ip(  # noqa: F811
    db: Session, monkeypatch: Any
) -> None:
    """CF-0094 (B101): the public match has a per-IP limit; the list does not."""
    monkeypatch.setitem(
        rate_limit.ACTION_LIMITS, "reference_price_match", rate_limit.Limit(2, 60)
    )
    reference_prices.load(db)
    app = FastAPI()
    app.include_router(reference_routes.router)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    def match() -> int:
        return client.get(
            "/reference-prices/match", params={"name": "Eggplant"}
        ).status_code

    assert match() == 200
    assert match() == 200
    blocked = client.get("/reference-prices/match", params={"name": "Eggplant"})
    assert blocked.status_code == 429
    assert blocked.headers.get("Retry-After")
    assert client.get("/reference-prices").status_code == 200
