from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

import requests

_DEFAULT_BASE_URL = "https://api.semaphore.co"
_SEND_MESSAGES_PATH = "/api/v4/messages"
# Dedicated OTP route: separate telco route, not rate limited, 2 credits / 160 chars.
# Semaphore says not to use it for regular messages.
_SEND_OTP_PATH = "/api/v4/otp"
OTP_PLACEHOLDER = "{otp}"

logger = logging.getLogger(__name__)


class SemaphoreError(RuntimeError):
    pass


@dataclass(frozen=True)
class SemaphoreConfig:
    api_key: str
    sendername: str | None = None
    base_url: str = _DEFAULT_BASE_URL


def load_semaphore_config() -> SemaphoreConfig:
    api_key = os.getenv("SEMAPHORE_KEY") or os.getenv("SEMAPHORE_API_KEY")
    if not api_key:
        raise SemaphoreError("Semaphore API key is not configured (SEMAPHORE_KEY)")
    sendername = os.getenv("SEMAPHORE_SENDERNAME") or os.getenv("SEMAPHORE_SENDER_NAME")
    base_url = os.getenv("SEMAPHORE_BASE_URL") or _DEFAULT_BASE_URL
    return SemaphoreConfig(api_key=api_key, sendername=sendername, base_url=base_url)


def _post(
    path: str,
    *,
    number: str,
    message: str,
    sendername: str | None,
    timeout_seconds: int,
    config: SemaphoreConfig | None,
    extra: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    if not number or not str(number).strip():
        raise SemaphoreError("Recipient number is required")
    if not message or not str(message).strip():
        raise SemaphoreError("Message is required")
    if str(message).lstrip().upper().startswith("TEST"):
        # Semaphore silently ignores messages that start with "TEST".
        raise SemaphoreError('Message must not start with the word "TEST"')

    cfg = config or load_semaphore_config()
    url = cfg.base_url.rstrip("/") + path

    data: dict[str, str] = {
        "apikey": cfg.api_key,
        "number": str(number).strip(),
        "message": str(message),
    }
    effective_sender = (sendername or cfg.sendername or "").strip() or None
    if effective_sender:
        data["sendername"] = effective_sender
    if extra:
        data.update(extra)

    try:
        resp = requests.post(url, data=data, timeout=timeout_seconds)
    except requests.RequestException as exc:
        raise SemaphoreError("Semaphore request failed") from exc

    try:
        payload = resp.json()
    except ValueError as exc:
        raise SemaphoreError("Semaphore returned a non-JSON response") from exc

    if not resp.ok:
        raise SemaphoreError(f"Semaphore error: {payload!r}")

    if not isinstance(payload, list):
        raise SemaphoreError(f"Unexpected Semaphore response: {payload!r}")

    return payload


def send_sms(
    *,
    number: str,
    message: str,
    sendername: str | None = None,
    timeout_seconds: int = 20,
    config: SemaphoreConfig | None = None,
) -> list[dict[str, Any]]:
    """Regular (queued, rate-limited) message. Not for OTPs — use send_otp."""
    return _post(
        _SEND_MESSAGES_PATH,
        number=number,
        message=message,
        sendername=sendername,
        timeout_seconds=timeout_seconds,
        config=config,
    )


def send_otp(
    *,
    number: str,
    message: str,
    code: str,
    sendername: str | None = None,
    timeout_seconds: int = 20,
    config: SemaphoreConfig | None = None,
) -> str:
    """Send an OTP via Semaphore's dedicated OTP route and return the code delivered.

    `message` must contain the literal ``{otp}`` placeholder; Semaphore substitutes
    `code` into it (without a placeholder it appends its own sentence instead).

    The returned code is what Semaphore reports it sent. Callers should store that,
    not their own copy: the docs are inconsistent about whether the custom-code
    parameter is ``code`` or ``otp``, and if it's ignored Semaphore generates its own.
    """
    if OTP_PLACEHOLDER not in message:
        raise SemaphoreError(f"OTP message must contain the {OTP_PLACEHOLDER} placeholder")
    if not code or not code.isdigit():
        raise SemaphoreError("OTP code must be numeric")

    payload = _post(
        _SEND_OTP_PATH,
        number=number,
        message=message,
        sendername=sendername,
        timeout_seconds=timeout_seconds,
        config=config,
        extra={"code": code},
    )

    returned = payload[0].get("code") if payload and isinstance(payload[0], dict) else None
    if returned is None:
        logger.warning("[sms] Semaphore OTP response had no code; assuming ours was used")
        return code
    # Docs show the code as a JSON number, which would drop leading zeros.
    delivered = str(returned).strip().zfill(len(code))
    if delivered != code:
        logger.warning("[sms] Semaphore OTP used a different code than requested")
    return delivered
