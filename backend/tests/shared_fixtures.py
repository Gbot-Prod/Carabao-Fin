"""Shared database fixtures, loaded for every test via conftest ``pytest_plugins``.

CF-0033: these lived in test_reviews.py and other modules imported them by name,
which ruff reports as F811 (redefinition of an unused import) at every test that
takes them as a parameter. A pytest plugin makes them available everywhere
without the import. A module that defines its own ``db`` still overrides it.
"""

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.merchant import Merchant
from app.models.shopPage import ShopPage
from app.models.user import User
from tests.better_auth import make_user


@compiles(JSONB, "sqlite")
def _jsonb_as_json(_type: Any, _compiler: Any, **_: Any) -> str:
    return "JSON"


@pytest.fixture
def db() -> Iterator[Session]:
    """Every table in in-memory SQLite, with foreign keys enforced."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn: Any, _: Any) -> None:
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def merchant(db: Session) -> Merchant:
    owner = make_user(db, "farmer@example.com")
    db.add(owner)
    db.flush()
    merchant = Merchant(
        verification_status="verified",
        user_id=owner.id,
        merchant_name="Dela Cruz Farm",
        contact_number="639171234567",
        region="Region III",
        province="Bulacan",
        address="Purok 1",
        postal_code="3000",
        available_days=["mon"],
        operating_hours={},
        seller_type="individual_farmer",
        rsbsa_document_path="rsbsa/1.pdf",
        gov_id_type="Passport",
        gov_id_document_path="gov-id/x.pdf",
    )
    db.add(merchant)
    db.flush()
    publish_shop_page(db, merchant)
    db.commit()
    return merchant


def publish_shop_page(
    db: Session, merchant: Merchant, *, title: str | None = None
) -> ShopPage:
    """A merchant is public to buyers only with a published shop page."""
    title = title or merchant.merchant_name
    page = ShopPage(
        merchant_id=merchant.id,
        title=title,
        slug=f"shop-{merchant.id}",
        published_at=datetime.now(UTC),
    )
    db.add(page)
    db.flush()
    return page


def _buyer(
    db: Session, email: str = "buyer@example.com", name: str = "Juan dela Cruz"
) -> tuple[User, None]:
    user = make_user(db, email, name=name)
    db.add(user)
    db.flush()
    db.commit()
    return user, None  # (user, _): kept for the many call sites


@pytest.fixture
def buyer(db: Session) -> tuple[User, None]:
    return _buyer(db)
