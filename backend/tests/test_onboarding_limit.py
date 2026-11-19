"""CF-0077: merchant application submits are limited per user, checked before
the documents are scanned or stored."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchant_onboarding
from app.services import r2_service, rate_limit, upload_validation
from tests.shared_fixtures import _buyer


def test_submits_are_limited_before_any_document_work(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(
        rate_limit.ACTION_LIMITS, "onboarding_submit", rate_limit.Limit(2, 60)
    )
    scans: list[str] = []

    def record(name: str) -> Any:
        def fake(*_a: Any, **_k: Any) -> None:
            scans.append(name)
            raise AssertionError(f"{name} must not run")

        return fake

    monkeypatch.setattr(upload_validation, "check_document_upload", record("scan"))
    monkeypatch.setattr(r2_service, "upload_rsbsa_document", record("r2"))
    user, _ = _buyer(db, "applicant@example.com")
    app = FastAPI()
    app.include_router(merchant_onboarding.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    files = {
        "rsbsa_file": ("a.pdf", b"%PDF-1.4", "application/pdf"),
        "gov_id_file": ("b.pdf", b"%PDF-1.4", "application/pdf"),
    }

    # Allowed calls go on to the normal checks (a bad payload here).
    for _ in range(2):
        res = client.post(
            "/merchant-onboarding/me", data={"payload": "not json"}, files=files
        )
        assert res.status_code == 400
    res = client.post(
        "/merchant-onboarding/me", data={"payload": "not json"}, files=files
    )

    assert res.status_code == 429
    assert int(res.headers["Retry-After"]) >= 1
    assert scans == []  # never reached the scan or R2

    other, _ = _buyer(db, "other@example.com")
    app.dependency_overrides[get_current_user] = lambda: other
    res = client.post(
        "/merchant-onboarding/me", data={"payload": "not json"}, files=files
    )
    assert res.status_code == 400  # another person is not limited


def test_default_leaves_room_for_corrections() -> None:
    limit = rate_limit.ACTION_LIMITS["onboarding_submit"]
    assert limit.max_hits >= 5 and limit.window_seconds == 3600
