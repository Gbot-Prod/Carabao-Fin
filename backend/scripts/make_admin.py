"""Make the first admin, or recover when no admin can sign in (CF-0018).

Admins are normally made by another admin (PATCH /admin/users/{id}/role). This
script is for the server only. It finds the account by its verified mobile
number or email, gives it the admin role, turns off any old 2FA, and makes a
one-time setup link (24 hours). The link is printed here, not sent.

    uv run python scripts/make_admin.py +639171234567
    uv run python scripts/make_admin.py admin@example.com
"""

import argparse
import importlib
import pkgutil
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi import HTTPException  # noqa: E402

# Every model, so relationships by name (User -> "Merchant") resolve.
import app.models as models_pkg  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.models.auth_identity import AuthIdentity  # noqa: E402
from app.models.user import User, normalize_email  # noqa: E402
from app.services import admin_enrolment, better_auth_store  # noqa: E402
from app.services.auth_identity import Identity, resolve_user  # noqa: E402
from app.services.phone_verification import normalize_ph_mobile  # noqa: E402

for _module in pkgutil.iter_modules(models_pkg.__path__):
    importlib.import_module(f"{models_pkg.__name__}.{_module.name}")


def _find_identity(db, contact: str) -> AuthIdentity | None:
    if "@" in contact:
        return (
            db.query(AuthIdentity)
            .filter(AuthIdentity.email == normalize_email(contact))
            .first()
        )
    number = normalize_ph_mobile(contact)  # "639XXXXXXXXX"
    if not number:
        return None
    # BetterAuth stores "+639XXXXXXXXX" (lib/phone.ts normalizePhMobile).
    return (
        db.query(AuthIdentity).filter(AuthIdentity.phone_number == f"+{number}").first()
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("contact", help="verified mobile number or email")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        identity = _find_identity(db, args.contact.strip())
        if identity is None:
            sys.exit("No account has that number or email. Sign up first.")
        user: User = resolve_user(db, Identity(subject=identity.id))
        try:
            admin_enrolment.require_contact(user)
        except HTTPException as exc:
            sys.exit(exc.detail)
        better_auth_store.set_role(db, identity.id, is_admin=True)
        better_auth_store.clear_two_factor(db, identity.id)
        token = admin_enrolment.issue(db, user)
        db.commit()
        print(f"{args.contact} is now an admin. All its sessions were ended.")
        print("Sign in on the website, then open this link (one time, 24 hours):")
        print(admin_enrolment.setup_url(token))
    finally:
        db.close()


if __name__ == "__main__":
    main()
