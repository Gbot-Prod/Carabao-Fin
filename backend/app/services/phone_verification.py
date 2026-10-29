from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any


def normalize_ph_mobile(value: str) -> str | None:
    """Return a PH mobile number as 63XXXXXXXXXX, or None if it isn't one."""
    compact = (
        value.strip()
        .replace(" ", "")
        .replace("-", "")
        .replace("(", "")
        .replace(")", "")
    )
    if compact.startswith("+"):
        compact = compact[1:]
    if compact.startswith("09") and len(compact) == 11:
        compact = f"63{compact[1:]}"
    if compact.startswith("9") and len(compact) == 10:
        compact = f"63{compact}"
    if not compact.startswith("63") or len(compact) != 12 or not compact.isdigit():
        return None
    return compact


def sign_token(data: dict[str, Any], ttl_seconds: int) -> str:
    """HMAC-sign a JSON payload with AUTH_SYNC_SHARED_SECRET. Raises if unset."""
    secret = os.getenv("AUTH_SYNC_SHARED_SECRET")
    if not secret:
        raise RuntimeError("AUTH_SYNC_SHARED_SECRET is not configured")
    payload = (
        base64.urlsafe_b64encode(
            json.dumps(
                {**data, "exp": int(time.time()) + ttl_seconds},
                separators=(",", ":"),
            ).encode()
        )
        .decode()
        .rstrip("=")
    )
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def read_token(token: str | None) -> dict[str, Any] | None:
    """Return the payload of a valid, unexpired token from sign_token, else None."""
    secret = os.getenv("AUTH_SYNC_SHARED_SECRET")
    if not token or not secret or "." not in token:
        return None
    payload, signature = token.rsplit(".", 1)
    expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        padded = payload + "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded).decode())
        if not isinstance(data, dict) or int(data["exp"]) < int(time.time()):
            return None
        return data
    except (ValueError, KeyError, TypeError):
        return None
