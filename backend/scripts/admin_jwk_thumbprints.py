"""Print the thumbprints of the admin deploy's JWT keys, for ADMIN_JWKS_THUMBPRINTS.

The API accepts an admin token only when its key's thumbprint is pinned
(app/core/security.py). Run this after web-admin has made its first key (the
first admin sign-in does), and again after any new key:

    uv run python scripts/admin_jwk_thumbprints.py

With the database logins split (SUBDOMAINS.md 3.1), carabao_api cannot read
"jwks_admin": set DATABASE_URL to the superuser's URL for this run.

It reads the "jwks_admin" table through DATABASE_URL and prints each key with
its creation time. Check the list before you pin it: every row should be one
the admin deploy made (expect one per rotation, created when an admin first
signed in). A row you cannot explain may have been written by someone else; do
not pin it, and treat it as a security incident.
"""

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import jwt  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.core.security import jwk_thumbprint  # noqa: E402


def main() -> int:
    with SessionLocal() as db:
        rows = db.execute(
            text(
                'SELECT id, "publicKey", "createdAt", "expiresAt" '
                'FROM jwks_admin ORDER BY "createdAt"'
            )
        ).all()
    if not rows:
        print(
            "jwks_admin has no keys yet. "
            "Sign in once on the admin site, then run this again."
        )
        return 1

    pins = []
    for kid, public_key, created_at, expires_at in rows:
        thumbprint = jwk_thumbprint(jwt.PyJWK(json.loads(public_key)).key)
        if thumbprint is None:
            print(f"{kid}: not an EdDSA key; the API does not accept it. Skipped.")
            continue
        expiry = f", expires {expires_at}" if expires_at else ""
        print(f"{kid}  created {created_at}{expiry}\n  thumbprint {thumbprint}")
        pins.append(thumbprint)

    print("\nAfter checking each row above, set on the API service:")
    print(f"ADMIN_JWKS_THUMBPRINTS={','.join(pins)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
