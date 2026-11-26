import base64
import hashlib
import hmac
import os
import time
from dataclasses import dataclass
from typing import Any

import requests

from app.services import money

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
    amount_centavos = money.to_centavos(amount_pesos)

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


@dataclass(frozen=True)
class PaidPayment:
    """A payment that landed on a checkout session, as PayMongo reports it."""

    id: str | None
    amount: int | None  # centavos
    currency: str | None


def _int_or_none(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def payment_from_object(payment: dict) -> PaidPayment:
    """A PaidPayment from one entry of a session's ``payments`` list."""
    attributes = payment.get("attributes") or {}
    return PaidPayment(
        id=payment.get("id"),
        amount=_int_or_none(attributes.get("amount")),
        currency=attributes.get("currency"),
    )


def paid_payment_from_session(session: dict) -> PaidPayment | None:
    """The paid payment on a checkout session, or None while it is unpaid.

    A session's own ``status`` is only ever ``active`` or ``expired``; the paid
    state lives on its payments (``paid``) and payment intent (``succeeded``).
    The amount and currency come from the payment (the intent's when the
    session lists no payment), so the caller can check them (CF-0005).
    """
    attributes = session.get("attributes") or {}
    payments = attributes.get("payments") or []
    for payment in payments:
        if (payment.get("attributes") or {}).get("status") == "paid":
            return payment_from_object(payment)
    intent = attributes.get("payment_intent") or {}
    intent_attributes = intent.get("attributes") or {}
    if intent_attributes.get("status") == "succeeded":
        if payments:
            return payment_from_object(payments[0])
        return PaidPayment(
            id=None,
            amount=_int_or_none(intent_attributes.get("amount")),
            currency=intent_attributes.get("currency"),
        )
    return None


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


class _TransferError(Exception):
    """CF-0074: ``str()`` is PayMongo's detail, for the admin's failure reason;
    it can repeat the destination account. ``codes`` holds only PayMongo's
    error codes, for logs."""

    def __init__(self, detail: str, codes: str = "") -> None:
        super().__init__(detail)
        self.codes = codes


class TransferRejected(_TransferError):
    """PayMongo refused the transfer (4xx): nothing was sent, safe to retry."""


class TransferOutcomeUnknown(_TransferError):
    """Timeout, network error or 5xx: the transfer may or may not exist."""


def _error_codes(response: Any) -> str:
    """PayMongo's error codes only (no detail text), or the HTTP status."""
    try:
        errors = response.json().get("errors") or []
        codes = sorted({str(e.get("code") or "error") for e in errors})
        if codes:
            return f"HTTP {response.status_code}: " + ", ".join(codes)
    except (ValueError, AttributeError):
        pass
    return f"HTTP {response.status_code}"


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
        raise TransferRejected(
            f"could not read the PayMongo wallet: {exc}",
            codes=f"wallet: {type(exc).__name__}",
        ) from exc
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
        raise TransferOutcomeUnknown(str(exc), codes=type(exc).__name__) from exc

    if response.status_code >= 500:
        raise TransferOutcomeUnknown(
            _error_detail(response), codes=_error_codes(response)
        )
    if response.status_code >= 400:
        raise TransferRejected(_error_detail(response), codes=_error_codes(response))

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


# ---------------------------------------------------------------------------
# Money back: refunds of a paid payment
# ---------------------------------------------------------------------------

# PayMongo's reason values differ between its pages; "others" is in all of
# them, and the notes say why.
REFUND_REASON = "others"
REFUND_NOTES_MAX = 255
# QR Ph refunds use a different host. api.paymongo.com/v1/refunds refuses
# them: "Refunds are not allowed for payments with source type qrph".
# https://docs.paymongo.com/docs/qrph-refunds.md
# QR Ph is our only payment method, so all refunds go here. The docs do not
# give the host for GET /refunds/{id}; we use the same host.
PAYMONGO_REFUNDS_URL = "https://refunds-api.paymongo.com/v1/refunds"


class RefundRejected(_TransferError):
    """PayMongo refused the refund (4xx): nothing was refunded, safe to retry."""


class RefundOutcomeUnknown(_TransferError):
    """Timeout, network error or 5xx: the refund may or may not exist."""


def create_refund(
    *,
    payment_id: str,
    amount_centavos: int,
    notes: str,
    metadata: dict[str, str] | None = None,
) -> dict:
    """Refund a paid payment; returns the refund object (``{id, attributes}``).

    Raises RefundRejected when PayMongo refuses it and RefundOutcomeUnknown
    when we cannot tell whether it was created.
    """
    attributes: dict[str, Any] = {
        "amount": amount_centavos,
        "payment_id": payment_id,
        "reason": REFUND_REASON,
        "notes": notes[:REFUND_NOTES_MAX],
    }
    if metadata:
        attributes["metadata"] = metadata
    try:
        response = requests.post(
            PAYMONGO_REFUNDS_URL,
            json={"data": {"attributes": attributes}},
            headers=_auth_header(),
            timeout=30,
        )
    except requests.RequestException as exc:
        raise RefundOutcomeUnknown(str(exc), codes=type(exc).__name__) from exc

    if response.status_code >= 500:
        raise RefundOutcomeUnknown(
            _error_detail(response), codes=_error_codes(response)
        )
    if response.status_code >= 400:
        raise RefundRejected(_error_detail(response), codes=_error_codes(response))
    try:
        refund = response.json()["data"]
    except (ValueError, KeyError, TypeError) as exc:
        raise RefundOutcomeUnknown("unreadable PayMongo response") from exc
    if not isinstance(refund, dict) or not refund.get("id"):
        raise RefundOutcomeUnknown("PayMongo accepted the refund but sent no id")
    return refund


def get_refund(refund_id: str) -> dict:
    response = requests.get(
        f"{PAYMONGO_REFUNDS_URL}/{refund_id}",
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
