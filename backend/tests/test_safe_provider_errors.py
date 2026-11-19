"""CF-0071: SMS and email provider errors reach the logs without the
number, the message (a code or a setup link) or any other value."""

from __future__ import annotations

import logging
from typing import Any

import pytest
import requests
from fastapi import HTTPException

from app.core.errors import describe_error
from app.integrations.sms import semaphore
from app.services import admin_enrolment

CFG = semaphore.SemaphoreConfig(api_key="k-secret", sendername="CARABAO")
NUMBER = "639171234567"
SECRET_MESSAGE = (
    "Your Carabao code is 482913. Setup: https://admin.x/enrol?token=tok-abc"
)


class _Resp:
    def __init__(self, status: int, body: Any) -> None:
        self.status_code = status
        self.ok = status < 400
        self._body = body

    def json(self) -> Any:
        return self._body


def _send_with(monkeypatch: pytest.MonkeyPatch, resp: _Resp) -> str:
    monkeypatch.setattr(requests, "post", lambda *a, **k: resp)  # semaphore uses it
    with pytest.raises(semaphore.SemaphoreError) as exc:
        semaphore.send_sms(number=NUMBER, message=SECRET_MESSAGE, config=CFG)
    return str(exc.value)


@pytest.mark.parametrize(
    "resp",
    [
        # Semaphore repeats the request in its validation errors.
        _Resp(422, {"number": [f"{NUMBER} is invalid"], "message": [SECRET_MESSAGE]}),
        _Resp(
            200, {"status": "failed", "message": SECRET_MESSAGE, "apikey": "k-secret"}
        ),
        _Resp(500, [{"number": NUMBER, "message": SECRET_MESSAGE}]),
    ],
)
def test_semaphore_errors_hold_no_values(
    monkeypatch: pytest.MonkeyPatch, resp: _Resp
) -> None:
    text = _send_with(monkeypatch, resp)
    for secret in (NUMBER, "482913", "tok-abc", "k-secret", "is invalid"):
        assert secret not in text, (secret, text)
    assert "Semaphore" in text


def test_semaphore_error_names_status_and_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    text = _send_with(monkeypatch, _Resp(422, {"number": ["bad"], "message": ["bad"]}))
    assert text == "Semaphore error (HTTP 422; fields: message, number)"


def test_describe_error_keeps_only_the_type_of_other_errors() -> None:
    assert describe_error(ValueError("to ana@example.com: rejected")) == "ValueError"
    safe = semaphore.SemaphoreError("Semaphore error (HTTP 422; fields: number)")
    assert (
        describe_error(safe)
        == "SemaphoreError: Semaphore error (HTTP 422; fields: number)"
    )


def test_admin_setup_link_does_not_reach_the_log(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def leaky(*_a: Any, **k: Any) -> None:
        raise RuntimeError(
            f"failed to send {k.get('message') or _a} to {NUMBER} / ana@example.com"
        )

    monkeypatch.setattr(admin_enrolment, "send_sms", leaky)
    monkeypatch.setattr(admin_enrolment, "send_admin_enrolment_email", leaky)

    class _User:
        id = 7
        phone_verified = True
        phone_number = "+" + NUMBER
        verified_email = "ana@example.com"

    with caplog.at_level(logging.WARNING, logger=admin_enrolment.__name__):
        with pytest.raises(HTTPException):  # 502: neither channel worked
            admin_enrolment.deliver(_User(), "tok-abc")  # type: ignore[arg-type]
    assert "Admin setup SMS failed for user 7: RuntimeError" in caplog.text
    for secret in ("tok-abc", NUMBER, "ana@example.com"):
        assert secret not in caplog.text, secret
