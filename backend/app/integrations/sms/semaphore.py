from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import requests


_DEFAULT_BASE_URL = "https://api.semaphore.co"
_SEND_MESSAGES_PATH = "/api/v4/messages"


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
    sendername = os.getenv("SEMAPHORE_SENDERNAME")
    base_url = os.getenv("SEMAPHORE_BASE_URL") or _DEFAULT_BASE_URL
    return SemaphoreConfig(api_key=api_key, sendername=sendername, base_url=base_url)


def send_sms(
    *,
    number: str,
    message: str,
    sendername: str | None = None,
    timeout_seconds: int = 20,
    config: SemaphoreConfig | None = None,
) -> list[dict[str, Any]]:
    if not number or not str(number).strip():
        raise SemaphoreError("Recipient number is required")
    if not message or not str(message).strip():
        raise SemaphoreError("Message is required")
    if str(message).lstrip().upper().startswith("TEST"):
        # Semaphore silently ignores messages that start with "TEST".
        raise SemaphoreError('Message must not start with the word "TEST"')

    cfg = config or load_semaphore_config()
    url = cfg.base_url.rstrip("/") + _SEND_MESSAGES_PATH

    data: dict[str, str] = {
        "apikey": cfg.api_key,
        "number": str(number).strip(),
        "message": str(message),
    }
    effective_sender = (sendername or cfg.sendername or "").strip() or None
    if effective_sender:
        data["sendername"] = effective_sender

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
