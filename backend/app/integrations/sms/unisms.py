from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from typing import Any

import requests


_BASE_URL = "https://unismsapi.com/api"
_SEND_PATH = "/sms"


class UniSMSError(RuntimeError):
    pass


@dataclass(frozen=True)
class UniSMSConfig:
    api_secret_key: str
    sender_id: str | None = None
    base_url: str = _BASE_URL


def load_unisms_config() -> UniSMSConfig:
    api_secret_key = os.getenv("UNISMS_API_SECRET_KEY")
    if not api_secret_key:
        raise UniSMSError("UniSMS API secret key is not configured (UNISMS_API_SECRET_KEY)")
    sender_id = os.getenv("UNISMS_SENDER_ID")
    base_url = os.getenv("UNISMS_BASE_URL") or _BASE_URL
    return UniSMSConfig(api_secret_key=api_secret_key, sender_id=sender_id, base_url=base_url)


def _auth_header(api_secret_key: str) -> str:
    # UniSMS Basic Auth: Base64(api_secret_key:) — empty password
    token = base64.b64encode(f"{api_secret_key}:".encode()).decode()
    return f"Basic {token}"


def send_sms(
    *,
    recipient: str,
    content: str,
    sender_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    timeout_seconds: int = 20,
    config: UniSMSConfig | None = None,
) -> dict[str, Any]:
    if not recipient or not str(recipient).strip():
        raise UniSMSError("Recipient number is required")
    if not content or not str(content).strip():
        raise UniSMSError("Message content is required")

    cfg = config or load_unisms_config()
    url = cfg.base_url.rstrip("/") + _SEND_PATH

    payload: dict[str, Any] = {
        "recipient": str(recipient).strip(),
        "content": str(content),
    }
    effective_sender = (sender_id or cfg.sender_id or "").strip() or None
    if effective_sender:
        payload["sender_id"] = effective_sender
    if metadata:
        payload["metadata"] = metadata

    headers = {
        "Content-Type": "application/json",
        "Authorization": _auth_header(cfg.api_secret_key),
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=timeout_seconds)
    except requests.RequestException as exc:
        raise UniSMSError("UniSMS request failed") from exc

    try:
        body = resp.json()
    except ValueError as exc:
        raise UniSMSError("UniSMS returned a non-JSON response") from exc

    if not resp.ok:
        raise UniSMSError(f"UniSMS error {resp.status_code}: {body!r}")

    return body
