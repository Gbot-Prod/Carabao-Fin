"""CF-0041: public farm responses carry ``updated_at`` for sitemap lastModified."""

from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.routes import merchants
from app.models.merchant import Merchant


def _client(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(merchants.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_public_list_and_detail_include_updated_at(
    db: Session, merchant: Merchant
) -> None:
    stamp = datetime(2026, 11, 12, 3, 4, 5, tzinfo=UTC)
    # Bulk update: sets the column as given (no onupdate=now()).
    db.query(Merchant).filter(Merchant.id == merchant.id).update({"updated_at": stamp})
    db.commit()
    client = _client(db)

    listed = client.get("/merchants")
    assert listed.status_code == 200, listed.text
    (row,) = listed.json()
    assert row["updated_at"].startswith("2026-11-12T03:04:05")

    detail = client.get(f"/merchants/{merchant.id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["updated_at"].startswith("2026-11-12T03:04:05")
