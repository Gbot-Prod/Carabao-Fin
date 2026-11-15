"""Application-level encryption for government identifiers (CF-0007).

TIN and RSBSA numbers are sensitive personal information (RA 10173). They are
stored encrypted with AES-256-GCM; the database never sees the plaintext.

- ``EncryptedString`` is a column type: Python code reads and writes plain
  strings, the column holds ``v1:<base64(nonce | ciphertext | tag)>``.
- Each value has a random nonce, so equal values give different ciphertexts.
  For lookups and duplicate checks use ``blind_index`` (HMAC-SHA256 with a
  separate key) and the ``*_hmac`` columns.
- ``mask`` gives the value for anyone who is not an admin.

Environment:
    FIELD_ENCRYPTION_KEY           base64 of 32 random bytes (required)
    FIELD_ENCRYPTION_KEY_PREVIOUS  old key, read-only, during key rotation
    FIELD_HMAC_KEY                 base64 of 32 random bytes (required)

Make a key with:
    python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import re
from functools import lru_cache

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

_PREFIX = "v1:"
_NONCE_BYTES = 12


class FieldCryptoError(RuntimeError):
    pass


def _load_key(name: str, required: bool = True) -> bytes | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        if required:
            raise FieldCryptoError(f"{name} is not set")
        return None
    try:
        key = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise FieldCryptoError(f"{name} is not valid base64") from exc
    if len(key) != 32:
        raise FieldCryptoError(f"{name} must decode to 32 bytes")
    return key


@lru_cache(maxsize=1)
def _keys() -> tuple[AESGCM, list[AESGCM], bytes]:
    current = _load_key("FIELD_ENCRYPTION_KEY")
    previous = _load_key("FIELD_ENCRYPTION_KEY_PREVIOUS", required=False)
    hmac_key = _load_key("FIELD_HMAC_KEY")
    assert current is not None and hmac_key is not None
    if hmac_key == current:
        raise FieldCryptoError("FIELD_HMAC_KEY must differ from FIELD_ENCRYPTION_KEY")
    readers = [AESGCM(current)] + ([AESGCM(previous)] if previous else [])
    return AESGCM(current), readers, hmac_key


def reset_keys() -> None:
    """Forget the loaded keys (for tests and key rotation)."""
    _keys.cache_clear()


def check_keys(stored_sample: str | None = None, purpose: str = "tin") -> None:
    """CF-0021: fail at startup, not at the first request that needs a key.

    Loads and validates every key, then does an encrypt / decrypt round trip.
    If ``stored_sample`` is given (a value read from the database), it must
    decrypt too: this finds a key that is valid but is not the key that
    encrypted the stored data. Raises FieldCryptoError on any failure.
    """
    reset_keys()  # Read the environment again; do not trust an old cache.
    _keys()
    probe = "field-crypto-startup-check"
    if decrypt(encrypt(probe, "startup-check"), "startup-check") != probe:
        raise FieldCryptoError("Encrypt / decrypt round trip gave a different value")
    if stored_sample is not None:
        try:
            decrypt(stored_sample, purpose)
        except FieldCryptoError as exc:
            raise FieldCryptoError(
                f"A stored {purpose} value cannot be decrypted with the configured "
                "keys. FIELD_ENCRYPTION_KEY (or FIELD_ENCRYPTION_KEY_PREVIOUS) is "
                "not the key that encrypted the data."
            ) from exc


def encrypt(plaintext: str, purpose: str) -> str:
    writer, _, _ = _keys()
    nonce = os.urandom(_NONCE_BYTES)
    # The purpose is bound as associated data, so a TIN ciphertext copied into
    # the RSBSA column does not decrypt.
    ct = writer.encrypt(nonce, plaintext.encode("utf-8"), purpose.encode())
    return _PREFIX + base64.b64encode(nonce + ct).decode("ascii")


def decrypt(stored: str, purpose: str) -> str:
    if not stored.startswith(_PREFIX):
        raise FieldCryptoError("Value is not encrypted")
    try:
        blob = base64.b64decode(stored[len(_PREFIX) :], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise FieldCryptoError("Encrypted value is damaged") from exc
    nonce, ct = blob[:_NONCE_BYTES], blob[_NONCE_BYTES:]
    _, readers, _ = _keys()
    for reader in readers:
        try:
            return reader.decrypt(nonce, ct, purpose.encode()).decode("utf-8")
        except InvalidTag:
            continue
    raise FieldCryptoError("Encrypted value cannot be decrypted with any key")


def normalize_identifier(value: str) -> str:
    """'123-456-789-000' and '123456789000' are the same TIN."""
    return re.sub(r"[^0-9A-Za-z]", "", value).upper()


def blind_index(value: str | None) -> str | None:
    """Keyed hash of the normalized value, for equality lookups only."""
    if value is None:
        return None
    normalized = normalize_identifier(value)
    if not normalized:
        return None
    _, _, hmac_key = _keys()
    return hmac.new(hmac_key, normalized.encode(), hashlib.sha256).hexdigest()


def mask(value: str | None, visible: int = 3) -> str | None:
    """'123-456-789-000' -> '***-***-***-000'. Separators stay in place."""
    if not value:
        return value
    total = sum(ch.isalnum() for ch in value)
    keep_from = max(total - visible, 0)
    out: list[str] = []
    seen = 0
    for ch in value:
        if ch.isalnum():
            out.append(ch if seen >= keep_from else "*")
            seen += 1
        else:
            out.append(ch)
    return "".join(out)


class EncryptedString(TypeDecorator[str]):
    """A string column that is stored encrypted with AES-256-GCM."""

    impl = Text
    cache_ok = True

    def __init__(self, purpose: str) -> None:
        super().__init__()
        self.purpose = purpose

    def process_bind_param(self, value: str | None, dialect: object) -> str | None:
        if value is None or value == "":
            return None
        return encrypt(value, self.purpose)

    def process_result_value(self, value: str | None, dialect: object) -> str | None:
        if value is None:
            return None
        return decrypt(value, self.purpose)
