import base64
import hashlib
import hmac
import os
import time
from typing import Optional

import requests

PAYMONGO_SECRET_KEY = os.getenv("PAYMONGO_SECRET_KEY")
PAYMONGO_WEBHOOK_SECRET = os.getenv("PAYMONGO_WEBHOOK_SECRET", "")
PAYMONGO_BASE_URL = "https://api.paymongo.com/v1"

SUPPORTED_METHODS = [
    "card",
    "gcash",
    "paymaya",
    "grab_pay",
]


def _auth_header() -> dict:
    if not PAYMONGO_SECRET_KEY:
        raise RuntimeError("PAYMONGO_SECRET_KEY is not set")
    encoded = base64.b64encode(f"{PAYMONGO_SECRET_KEY}:".encode()).decode()
    return {"Authorization": f"Basic {encoded}", "Content-Type": "application/json"}


def create_checkout_session(
    amount_pesos: int,
    description: str,
    merchant_name: str,
    success_url: str,
    cancel_url: str,
    reference_number: Optional[str] = None,
) -> dict:
    """Returns the checkout session data object from PayMongo."""
    amount_centavos = amount_pesos * 100

    payload: dict = {
        "data": {
            "attributes": {
                "amount": amount_centavos,
                "currency": "PHP",
                "description": description,
                "payment_method_types": SUPPORTED_METHODS,
                "success_url": success_url,
                "cancel_url": cancel_url,
                "show_description": True,
                "show_line_items": True,
                "line_items": [
                    {
                        "currency": "PHP",
                        "amount": amount_centavos,
                        "description": description,
                        "name": f"Payment to {merchant_name}",
                        "quantity": 1,
                    }
                ],
            }
        }
    }

    if reference_number:
        payload["data"]["attributes"]["reference_number"] = reference_number

    response = requests.post(
        f"{PAYMONGO_BASE_URL}/checkout_sessions",
        json=payload,
        headers=_auth_header(),
        timeout=15,
    )
    response.raise_for_status()
    return response.json()["data"]


def retrieve_checkout_session(session_id: str) -> dict:
    response = requests.get(
        f"{PAYMONGO_BASE_URL}/checkout_sessions/{session_id}",
        headers=_auth_header(),
        timeout=15,
    )
    response.raise_for_status()
    return response.json()["data"]


def verify_webhook_signature(raw_body: bytes, signature_header: str) -> bool:
    """
    PayMongo sends: Paymongo-Signature: t=<ts>,te=<test_hmac>,li=<live_hmac>
    Signed payload: "<timestamp>.<raw_body>"
    """
    if not PAYMONGO_WEBHOOK_SECRET or not signature_header:
        return False

    parts: dict[str, str] = {}
    for part in signature_header.split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            parts[k.strip()] = v.strip()

    timestamp_str = parts.get("t")
    sigs = [s for s in (parts.get("li"), parts.get("te")) if s]

    if not timestamp_str or not sigs:
        return False

    try:
        timestamp = int(timestamp_str)
    except ValueError:
        return False

    # Basic replay protection
    if abs(int(time.time()) - timestamp) > 300:
        return False

    signed_payload = f"{timestamp_str}.".encode("utf-8") + raw_body
    computed = hmac.new(
        PAYMONGO_WEBHOOK_SECRET.encode(),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()

    return any(hmac.compare_digest(computed, sig) for sig in sigs)
