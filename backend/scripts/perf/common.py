"""Paths, seeded accounts and the database guard shared by the SOP 3 scripts."""

import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
RESULTS_ROOT = BACKEND_ROOT / "scripts" / "results" / "perf"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

LOCAL_PERF_PORT = 55432
DEFAULT_PERF_DATABASE_URL = (
    f"postgresql+psycopg://postgres@127.0.0.1:{LOCAL_PERF_PORT}/carabao_perf"
)

# Sign-in lives in BetterAuth, which the perf run doesn't start. The instrumented
# app trusts this fixed key instead (instrumented_app.py), and the load test signs
# its own tokens with it. Only ever trusted by the perf app, never the real one.
PERF_ISSUER = "http://perf.carabao.local"
PERF_AUDIENCE = "carabao-api"


def perf_signing_key():
    import hashlib

    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    return Ed25519PrivateKey.from_private_bytes(
        hashlib.sha256(b"carabao-perf-signing-key").digest()
    )


def perf_subject(email: str) -> str:
    """The seeded external_auth_id for an email, and the token subject."""
    return f"perf:{email}"


def perf_token(email: str, ttl_seconds: int = 900) -> str:
    import time

    import jwt

    now = int(time.time())
    claims = {
        "sub": perf_subject(email),
        "email": email,
        "emailVerified": True,
        "iss": PERF_ISSUER,
        "aud": PERF_AUDIENCE,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    return jwt.encode(claims, perf_signing_key(), algorithm="EdDSA")


def buyer_email(index: int) -> str:
    return f"perf-buyer-{index:04d}@example.com"


def merchant_email(index: int) -> str:
    return f"perf-merchant-{index:04d}@example.com"


def perf_database_url() -> str:
    """Return the perf database URL, refusing anything that could be real data.

    The app's .env points at the deployed database, so every script that seeds,
    resets or serves goes through this check first.
    """
    from dotenv import dotenv_values
    from sqlalchemy.engine import make_url

    from app.core.database_url import normalize_database_url

    raw = os.getenv("PERF_DATABASE_URL", DEFAULT_PERF_DATABASE_URL)
    url = make_url(normalize_database_url(raw))
    if "perf" not in (url.database or ""):
        raise SystemExit(
            f"Refusing database {url.database!r} on {url.host}: the name must "
            "contain 'perf'. These scripts truncate and reseed their target."
        )

    app_url = dotenv_values(BACKEND_ROOT / ".env").get("DATABASE_URL")
    if app_url:
        app = make_url(normalize_database_url(app_url))
        if (app.host, app.port, app.database) == (url.host, url.port, url.database):
            raise SystemExit("PERF_DATABASE_URL is the same as the app's DATABASE_URL.")
    return url.render_as_string(hide_password=False)


def use_perf_database() -> None:
    """Point app.core.database at the perf database. Call before importing app.*."""
    from dotenv import load_dotenv

    load_dotenv(BACKEND_ROOT / ".env")
    os.environ["DATABASE_URL"] = perf_database_url()
