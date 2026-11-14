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
def is_test_mode() -> bool:
    return os.getenv("PAYMONGO_USE_TEST", "false").lower() == "true"


def get_webhook_secret() -> str:
    return os.getenv("PAYMONGO_WEBHOOK_SECRET", "")


def _auth_header() -> dict:
    key_name = "PAYMONGO_SECRET_TEST_KEY" if is_test_mode() else "PAYMONGO_SECRET_KEY"
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


def paid_payment_from_session(session: dict) -> tuple[bool, str | None]:
    """Whether a checkout session has been paid, and the paid payment's ID.

    A session's own ``status`` is only ever ``active`` or ``expired``; the paid
    state lives on its payments (``paid``) and payment intent (``succeeded``).
    """
    attributes = session.get("attributes") or {}
    for payment in attributes.get("payments") or []:
        if (payment.get("attributes") or {}).get("status") == "paid":
            return True, payment.get("id")
    intent = attributes.get("payment_intent") or {}
    if (intent.get("attributes") or {}).get("status") == "succeeded":
        payments = attributes.get("payments") or []
        return True, payments[0].get("id") if payments else None
    return False, None


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


# ---------------------------------------------------------------------------
# Money out: wallet transfers (InstaPay / PESONet) to merchants
# ---------------------------------------------------------------------------

PAYMONGO_API_ROOT = "https://api.paymongo.com"
# Every PayMongo wallet sends from this BIC (per the batch transfer reference).
PAYMONGO_WALLET_BIC = "PAEYPHM2XXX"
INSTITUTIONS_CACHE_SECONDS = 6 * 60 * 60

_institutions_cache: dict[str, tuple[float, list[dict]]] = {}


class TransferRejected(Exception):
    """PayMongo refused the transfer (4xx): nothing was sent, safe to retry."""


class TransferOutcomeUnknown(Exception):
    """Timeout, network error or 5xx: the transfer may or may not exist."""


def _error_detail(response) -> str:
    try:
        errors = response.json().get("errors") or []
        if errors:
            return "; ".join(
                f"{e.get('code', 'error')}: {e.get('detail', '')}".strip()
                for e in errors
            )
    except ValueError:
        pass
    return f"HTTP {response.status_code}"


def get_wallet_account() -> dict:
    """The default activated wallet's account, used as the transfer source."""
    response = requests.get(
        f"{PAYMONGO_API_ROOT}/v2/wallets",
        params=[("status", "activated"), ("fields", "account")],
        headers=_auth_header(),
        timeout=15,
    )
    response.raise_for_status()
    wallets = response.json().get("data") or []
    wallet = next((w for w in wallets if w.get("is_default")), None) or (
        wallets[0] if wallets else None
    )
    account = (wallet or {}).get("account") or {}
    if not account.get("account_number"):
        raise RuntimeError(
            "No activated PayMongo wallet found for these API keys "
            "(test keys have no wallet; transfers need live keys)"
        )
    return {
        "number": account["account_number"],
        "name": account.get("account_name") or "",
        "bic": PAYMONGO_WALLET_BIC,
    }


def get_wallet_balance() -> dict:
    """The default wallet's balance in centavos: ``{available, pending}``."""
    response = requests.get(
        f"{PAYMONGO_API_ROOT}/v2/wallets",
        params=[("status", "activated"), ("fields", "balance")],
        headers=_auth_header(),
        timeout=15,
    )
    response.raise_for_status()
    wallets = response.json().get("data") or []
    wallet = next((w for w in wallets if w.get("is_default")), None) or (
        wallets[0] if wallets else None
    )
    if wallet is None:
        raise RuntimeError("No activated PayMongo wallet found for these API keys")
    balance = wallet.get("balance") or {}
    return {
        "available": int(balance.get("available") or 0),
        "pending": int(balance.get("pending") or 0),
    }


def list_receiving_institutions(provider: str = "instapay") -> list[dict]:
    """Banks and e-wallets PayMongo can send to: ``[{code, name}]`` by name.

    ``code`` is the institution's ``provider_code`` (its BIC), which is what a
    transfer's ``destination_account.bic`` takes. Cached for a few hours.
    """
    cached = _institutions_cache.get(provider)
    if cached and time.monotonic() - cached[0] < INSTITUTIONS_CACHE_SECONDS:
        return cached[1]

    response = requests.get(
        f"{PAYMONGO_API_ROOT}/v1/wallets/receiving_institutions",
        params={"provider": provider},
        headers=_auth_header(),
        timeout=15,
    )
    response.raise_for_status()
    institutions = sorted(
        (
            {"code": attrs["provider_code"], "name": attrs.get("name") or ""}
            for attrs in (
                item.get("attributes") or {}
                for item in response.json().get("data") or []
            )
            if attrs.get("provider_code")
        ),
        key=lambda i: i["name"].lower(),
    )
    _institutions_cache[provider] = (time.monotonic(), institutions)
    return institutions


def create_transfer(
    *,
    amount_centavos: int,
    destination: dict,
    reference_number: str,
    description: str,
    provider: str = "instapay",
    metadata: dict | None = None,
) -> dict:
    """Send one transfer from the wallet; returns the transfer object.

    ``provider`` is ``instapay`` (minutes, up to ₱50,000) or ``pesonet``
    (banking-day cycles, up to ₱10,000,000).

    ``destination`` is ``{number, name, bic}``. Raises TransferRejected when
    PayMongo refuses it and TransferOutcomeUnknown when we cannot tell.
    """
    try:
        source = get_wallet_account()
    except Exception as exc:  # nothing has been sent yet
        raise TransferRejected(f"could not read the PayMongo wallet: {exc}") from exc
    transfer: dict = {
        "source_account": source,
        "destination_account": destination,
        "amount": amount_centavos,
        "currency": "PHP",
        "provider": provider,
        "reference_number": reference_number,
        "purpose": "Disbursement",
        "description": description,
    }
    if metadata:
        transfer["metadata"] = metadata

    try:
        response = requests.post(
            f"{PAYMONGO_API_ROOT}/v2/batch_transfers",
            json={"transfers": [transfer]},
            headers=_auth_header(),
            timeout=30,
        )
    except requests.RequestException as exc:
        raise TransferOutcomeUnknown(str(exc)) from exc

    if response.status_code >= 500:
        raise TransferOutcomeUnknown(_error_detail(response))
    if response.status_code >= 400:
        raise TransferRejected(_error_detail(response))

    try:
        transfers = (response.json().get("data") or {}).get("transfers") or []
    except ValueError as exc:
        raise TransferOutcomeUnknown("unreadable PayMongo response") from exc
    if not transfers:
        raise TransferOutcomeUnknown(
            "PayMongo accepted the batch but listed no transfer"
        )
    return transfers[0]


def get_transfer(transfer_id: str) -> dict:
    response = requests.get(
        f"{PAYMONGO_API_ROOT}/v2/transfers/{transfer_id}",
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
    sig = parts.get("te") if is_test_mode() else parts.get("li")

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
