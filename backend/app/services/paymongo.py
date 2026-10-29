import base64
import hashlib
import hmac
import os
import time

import requests

PAYMONGO_BASE_URL = "https://api.paymongo.com/v1"

SUPPORTED_METHODS = [
    "card",
    "gcash",
    "paymaya",
    "grab_pay",
    "qrph",
]


# Settings are read per call rather than at import time so they don't depend on
# load_dotenv() having run before this module was first imported.
def _use_test_mode() -> bool:
    return os.getenv("PAYMONGO_USE_TEST", "false").lower() == "true"


def get_webhook_secret() -> str:
    return os.getenv("PAYMONGO_WEBHOOK_SECRET", "")


def _auth_header() -> dict:
    key_name = "PAYMONGO_SECRET_TEST_KEY" if _use_test_mode() else "PAYMONGO_SECRET_KEY"
    secret_key = os.getenv(key_name)
    if not secret_key:
        raise RuntimeError(f"{key_name} is not set")
    encoded = base64.b64encode(f"{secret_key}:".encode()).decode()
    return {"Authorization": f"Basic {encoded}", "Content-Type": "application/json"}


def create_checkout_session(
    amount_pesos: int,
    description: str,
    merchant_name: str,
    success_url: str,
    cancel_url: str,
    reference_number: str | None = None,
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


def expire_checkout_session(session_id: str) -> bool:
    """Expire a checkout session so it can no longer be paid.

    Returns True once the session is expired (or unknown to PayMongo) and False
    when PayMongo refuses because a payment is already paid or in progress.
    """
    response = requests.post(
        f"{PAYMONGO_BASE_URL}/checkout_sessions/{session_id}/expire",
        headers=_auth_header(),
        timeout=15,
    )
    if response.status_code == 404:
        return True
    if response.status_code == 400:
        # Refused: already expired, already paid, or a payment is in progress.
        session = retrieve_checkout_session(session_id)
        return session["attributes"].get("status") == "expired"
    response.raise_for_status()
    return True


def get_or_create_paymongo_customer(db, user) -> str:
    """Return the user's PayMongo customer ID, creating one if needed."""
    if user.paymongo_customer_id:
        return user.paymongo_customer_id

    response = requests.post(
        f"{PAYMONGO_BASE_URL}/customers",
        json={
            "data": {
                "attributes": {
                    "email": user.email,
                    "first_name": user.first_name or "",
                    "last_name": user.last_name or "",
                    "phone": user.phone_number or "",
                    "default_device": "phone",
                }
            }
        },
        headers=_auth_header(),
        timeout=15,
    )
    response.raise_for_status()
    customer_id: str = response.json()["data"]["id"]

    user.paymongo_customer_id = customer_id
    db.commit()
    return customer_id


def list_customer_payment_methods(customer_id: str) -> list:
    response = requests.get(
        f"{PAYMONGO_BASE_URL}/customers/{customer_id}/payment_methods",
        headers=_auth_header(),
        timeout=15,
    )
    if response.status_code == 404:
        return []
    response.raise_for_status()
    return response.json().get("data", [])


def attach_payment_method(customer_id: str, payment_method_id: str) -> dict:
    response = requests.post(
        f"{PAYMONGO_BASE_URL}/customers/{customer_id}/payment_methods",
        json={"data": {"attributes": {"payment_method_id": payment_method_id}}},
        headers=_auth_header(),
        timeout=15,
    )
    response.raise_for_status()
    return response.json()["data"]


def detach_payment_method(customer_id: str, payment_method_id: str) -> None:
    response = requests.delete(
        f"{PAYMONGO_BASE_URL}/customers/{customer_id}/payment_methods/{payment_method_id}",
        headers=_auth_header(),
        timeout=15,
    )
    response.raise_for_status()


def verify_webhook_signature(raw_body: bytes, signature_header: str) -> bool:
    """
    PayMongo sends: Paymongo-Signature: t=<ts>,te=<test_hmac>,li=<live_hmac>
    Signed payload: "<timestamp>.<raw_body>"
    """
    webhook_secret = get_webhook_secret()
    if not webhook_secret or not signature_header:
        return False

    parts: dict[str, str] = {}
    for part in signature_header.split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            parts[k.strip()] = v.strip()

    timestamp_str = parts.get("t")
    # Test-mode events are signed in `te`, live-mode events in `li`.
    sig = parts.get("te") if _use_test_mode() else parts.get("li")

    if not timestamp_str or not sig:
        return False

    try:
        timestamp = int(timestamp_str)
    except ValueError:
        return False

    if abs(int(time.time()) - timestamp) > 300:
        return False

    signed_payload = f"{timestamp_str}.".encode() + raw_body
    computed = hmac.new(
        webhook_secret.encode(),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(computed, sig)
