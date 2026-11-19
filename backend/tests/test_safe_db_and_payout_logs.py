"""CF-0074 (B85): database error texts and PayMongo transfer errors reach the
logs without SQL values or account numbers."""

from __future__ import annotations

import logging
from typing import Any

import pytest
from sqlalchemy import Column, Integer, MetaData, String, Table, text
from sqlalchemy.exc import IntegrityError

from app.core.database import engine as app_engine
from app.core.database_url import create_db_engine
from app.models.statuses import PayoutStatus
from app.services import paymongo, payout_service
from tests.test_payouts import (  # noqa: F401 - fixtures
    _admin_client,
    _requested_batch,
    transfers,
)

ACCOUNT = "109876543210"


def test_db_errors_hide_their_values() -> None:
    engine = create_db_engine("sqlite://")
    meta = MetaData()
    people = Table(
        "people", meta, Column("id", Integer, primary_key=True), Column("email", String)
    )
    meta.create_all(engine)
    with engine.begin() as conn:
        conn.execute(people.insert().values(id=1, email="ana@example.com"))
    with pytest.raises(IntegrityError) as exc, engine.begin() as conn:
        conn.execute(people.insert().values(id=1, email="ben@example.com"))
    assert "ben@example.com" not in str(exc.value)
    assert "hidden" in str(exc.value)


def test_the_app_engine_hides_values_and_callers_can_opt_out() -> None:
    assert app_engine.hide_parameters is True
    assert create_db_engine("sqlite://", hide_parameters=False).hide_parameters is False


class _Resp:
    def __init__(self, status: int, body: Any) -> None:
        self.status_code = status
        self._body = body

    def json(self) -> Any:
        return self._body


def test_transfer_error_keeps_detail_but_codes_hold_no_values() -> None:
    resp = _Resp(
        400,
        {
            "errors": [
                {
                    "code": "parameter_invalid",
                    "detail": f"destination.number {ACCOUNT} is invalid",
                },
                {"code": "parameter_invalid", "detail": "destination.name Ana Santos"},
            ]
        },
    )
    assert ACCOUNT in paymongo._error_detail(resp)  # for the admin's failure reason
    codes = paymongo._error_codes(resp)
    assert codes == "HTTP 400: parameter_invalid"
    assert paymongo._error_codes(_Resp(502, "not json")) == "HTTP 502"


@pytest.mark.parametrize(
    "error",
    [
        paymongo.TransferRejected(
            f"parameter_invalid: destination.number {ACCOUNT} is invalid",
            codes="HTTP 400: parameter_invalid",
        ),
        paymongo.TransferOutcomeUnknown(
            f"timeout sending to {ACCOUNT}", codes="ReadTimeout"
        ),
    ],
)
def test_payout_logs_hold_codes_not_the_account(
    db: Any,
    merchant: Any,
    buyer: Any,
    transfers: Any,  # noqa: F811
    caplog: pytest.LogCaptureFixture,
    error: Exception,
) -> None:
    batch = _requested_batch(db, merchant, buyer)
    transfers.result = error

    with caplog.at_level(logging.WARNING, logger=payout_service.__name__):
        res = _admin_client(db).patch(f"/admin/batches/{batch['id']}/release").json()

    assert ACCOUNT not in caplog.text
    assert f"Payout batch {batch['id']}" in caplog.text
    assert error.codes in caplog.text  # type: ignore[attr-defined]
    # The admin still sees what PayMongo said.
    assert ACCOUNT in (res["failure_reason"] or "")
    assert res["status"] in {PayoutStatus.FAILED, PayoutStatus.PROCESSING}


def test_raw_sql_text_is_not_affected() -> None:
    engine = create_db_engine("sqlite://")
    with engine.connect() as conn:
        assert conn.execute(text("select 1")).scalar() == 1
