"""Guards against the event-loop deadlock and per-row query loops coming back."""

import inspect
import os
import subprocess
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_db
from app.api.routes import merchants
from app.api.routes.router import router
from app.models import (  # noqa: F401  (registers related mappers)
    cart,
    merchant_application,
    merchant_payout,
    order,
    payout_batch,
    shipment,
    transaction,
    user,
)
from app.models.auth_identity import AuthIdentity
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.produce import Produce
from app.models.shopPage import ShopPage
from app.models.user import User

# Async only to read the raw request body; it hands database work to a thread.
ALLOWED_ASYNC_ROUTES = {"/webhooks/paymongo"}


def _all_routes(routes):
    for route in routes:
        if hasattr(route, "endpoint"):
            yield route
        else:
            nested = getattr(route, "original_router", None) or route
            yield from _all_routes(nested.routes)


def test_routes_do_not_run_on_the_event_loop():
    """An async route that blocks on the database pool stalls the whole server."""
    routes = list(_all_routes(router.routes))
    assert len(routes) > 50
    async_routes = {
        route.path for route in routes if inspect.iscoroutinefunction(route.endpoint)
    }
    assert async_routes == ALLOWED_ASYNC_ROUTES


def test_app_imports_in_a_fresh_process():
    """main.py imports routes before models, so routes can't configure mappers early."""
    # Importing only builds the engine; it never connects to this address.
    env = {**os.environ, "DATABASE_URL": "postgresql://unused@127.0.0.1:1/unused"}
    result = subprocess.run(
        [sys.executable, "-c", "import main"], capture_output=True, text=True, env=env
    )
    assert result.returncode == 0, result.stderr


@pytest.fixture
def db_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    for model in (AuthIdentity, User, Merchant, MerchantApplication, ShopPage, Produce):
        model.__table__.create(engine)
    return engine


def _add_merchants(session, count):
    for i in range(1, count + 1):
        session.add(User(id=i, notifications_preferences={}))
        session.add(
            Merchant(
                id=i,
                user_id=i,
                merchant_name=f"Farm {i}",
                region="NCR",
                province="Metro Manila",
                address="1 Rizal Ave",
                postal_code="1100",
                available_days=["Mon"],
                operating_hours={},
                price_range_min=1,
                price_range_max=2,
                business_type="individual",
                rsbsa_document_path="x.pdf",
            )
        )
        session.add(ShopPage(merchant_id=i, title=f"Farm {i}", slug=f"farm-{i}"))
        session.add(Produce(merchant_id=i, name="Mango", price=10))
    session.commit()


def _statements_for_listing(engine, merchant_count):
    session = sessionmaker(bind=engine)()
    _add_merchants(session, merchant_count)

    app = FastAPI()
    app.include_router(merchants.router)
    app.dependency_overrides[get_db] = lambda: session
    client = TestClient(app)

    statements = []

    def count(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        response = client.get("/merchants")
    finally:
        event.remove(engine, "before_cursor_execute", count)
        session.close()

    assert response.status_code == 200
    body = response.json()
    assert len(body) == merchant_count
    assert all(m["shop_page"] and m["produces"] for m in body)
    return len(statements)


@pytest.mark.parametrize("merchant_count", [2, 25])
def test_merchant_listing_query_count_does_not_grow(db_engine, merchant_count):
    assert _statements_for_listing(db_engine, merchant_count) <= 3
