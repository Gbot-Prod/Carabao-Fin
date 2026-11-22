"""The database logins and guards on a real Postgres (DB_ROLE_SPLIT_PLAN.md,
section 7). The SQLite suite in tests/ cannot see roles or row-level security.

Opt-in: runs only when PG_TEST_URL is set to a SUPERUSER URL of a throwaway
Postgres (LOCAL_DATABASE.md section 11):

    docker run -d --name carabao-pg-roletest -e POSTGRES_PASSWORD=postgres \
        -p 5433:5432 postgres:17
    $env:PG_TEST_URL = "postgresql://postgres:postgres@localhost:5433/postgres"
    uv run pytest tests_pg -v

The fixture makes a new database on that server, builds it the way production
was built (Better Auth tables, then the API tables, all owned by the
superuser), seeds a few accounts, then runs roles.sql and guards.sql twice
(they must be idempotent). It sets test passwords on the four logins: roles
belong to the whole server, so PG_TEST_URL must not point at a shared or
production server. Only localhost is accepted unless PG_TEST_ALLOW_REMOTE=1
(the Railway fork rehearsal).

Every check connects AS a service login, never as the superuser: superusers
skip row-level security, and the guards let them through, so a check run as
"postgres" would prove nothing. The first thing each check connection does is
assert its current_user and that it is neither superuser nor BYPASSRLS.
"""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import pytest

psycopg = pytest.importorskip("psycopg")
from psycopg import errors  # noqa: E402

PG_TEST_URL = os.getenv("PG_TEST_URL", "").strip()

pytestmark = pytest.mark.skipif(
    not PG_TEST_URL, reason="PG_TEST_URL is not set (opt-in Postgres test)"
)

BACKEND = Path(__file__).resolve().parents[1]
WEB = BACKEND.parent / "frontend" / "carabao-app"
ROLES_SQL = BACKEND / "db" / "roles.sql"
GUARDS_SQL = BACKEND / "db" / "guards.sql"

API = "carabao_api"
WEB_PUBLIC = "carabao_web_public"
WEB_ADMIN = "carabao_web_admin"
OWNER = "carabao_owner"
SERVICE_LOGINS = (API, WEB_PUBLIC, WEB_ADMIN)

ADMIN_PHONE = "+639170000001"
BUYER_PHONE = "+639170000002"

BETTER_AUTH_TABLES = (
    "user",
    "session",
    "account",
    "verification",
    "twoFactor",
    "rateLimit",
    "jwks",
    "jwks_admin",
)


# ── Setup ───────────────────────────────────────────────────────────────────


def _with(
    url: str,
    *,
    user: str | None = None,
    password: str | None = None,
    dbname: str | None = None,
) -> str:
    parts = urlsplit(url)
    host = parts.hostname or "localhost"
    if ":" in host:
        host = f"[{host}]"
    netloc_host = f"{host}:{parts.port}" if parts.port else host
    user = user if user is not None else (parts.username or "")
    password = password if password is not None else (parts.password or "")
    auth = quote(user, safe="")
    if password:
        auth += ":" + quote(password, safe="")
    path = f"/{dbname}" if dbname is not None else parts.path
    return urlunsplit((parts.scheme, f"{auth}@{netloc_host}", path, parts.query, ""))


def _psycopg_url(url: str) -> str:
    # psycopg wants postgresql://; SQLAlchemy URLs may say postgresql+psycopg://.
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def _run(cmd: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    result = subprocess.run(
        cmd, cwd=cwd, env=env, capture_output=True, text=True, shell=False
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"{' '.join(cmd)} failed ({result.returncode}):\n"
            f"{result.stdout}\n{result.stderr}"
        )


def _now() -> datetime:
    return datetime.now(UTC)


def _id() -> str:
    return secrets.token_hex(16)


@dataclass
class Cluster:
    superuser_url: str  # the new database, as the superuser
    urls: dict[str, str] = field(default_factory=dict)  # login -> URL
    admin_id: str = ""  # an admin with a password and TOTP
    pending_admin_id: str = ""  # an admin with a password, 2FA not set up
    unaccepted_admin_id: str = ""  # an invited admin with no password yet
    buyer_id: str = ""
    banned_buyer_id: str = ""
    two_factor_buyer_id: str = ""  # a non-admin with twoFactorEnabled = true

    def superuser(self):
        return psycopg.connect(self.superuser_url, autocommit=True)

    def connect(self, login: str):
        """A connection as ``login``, checked to really be that login."""
        conn = psycopg.connect(self.urls[login])
        who, is_super, bypass = conn.execute(
            "SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r "
            "WHERE r.rolname = current_user"
        ).fetchone()
        assert who == login
        assert is_super is False and bypass is False, f"{login} must not skip RLS"
        conn.rollback()
        return conn


def _seed_user(
    conn,
    *,
    role: str | None,
    email: str,
    phone: str | None = None,
    two_factor: bool = False,
    banned: bool = False,
    password: bool = True,
) -> str:
    uid = _id()
    now = _now()
    conn.execute(
        'INSERT INTO "user" (id, name, email, "emailVerified", role, banned, '
        '"banReason", "twoFactorEnabled", "phoneNumber", "phoneNumberVerified", '
        '"createdAt", "updatedAt") '
        "VALUES (%s, %s, %s, true, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            uid,
            email.split("@")[0],
            email,
            role,
            banned,
            "Suspended in a test" if banned else None,
            two_factor,
            phone,
            phone is not None,
            now,
            now,
        ),
    )
    if password:
        conn.execute(
            'INSERT INTO "account" (id, "accountId", "providerId", "userId", '
            'password, "createdAt", "updatedAt") VALUES (%s, %s, %s, %s, %s, %s, %s)',
            (_id(), uid, "credential", uid, "salt:hash-of-" + email, now, now),
        )
    conn.execute(
        'INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt", '
        '"updatedAt") VALUES (%s, %s, %s, %s, %s, %s)',
        (_id(), _id(), uid, now + timedelta(days=1), now, now),
    )
    if two_factor:
        conn.execute(
            'INSERT INTO "twoFactor" (id, secret, "backupCodes", "userId") '
            "VALUES (%s, %s, %s, %s)",
            (_id(), "secret", "codes", uid),
        )
    return uid


@pytest.fixture(scope="module")
def cluster() -> Iterator[Cluster]:
    base = _psycopg_url(PG_TEST_URL)
    host = urlsplit(base).hostname or ""
    if (
        host not in {"localhost", "127.0.0.1", "::1"}
        and os.getenv("PG_TEST_ALLOW_REMOTE") != "1"
    ):
        pytest.fail(
            f"PG_TEST_URL points at {host!r}. This test sets passwords on the "
            "server's carabao_* logins; use a throwaway local Postgres, or set "
            "PG_TEST_ALLOW_REMOTE=1 for a disposable remote one."
        )

    dbname = f"carabao_roletest_{secrets.token_hex(4)}"
    with psycopg.connect(base, autocommit=True) as conn:
        is_super = conn.execute(
            "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
        ).fetchone()[0]
        if not is_super:
            pytest.fail("PG_TEST_URL must be a superuser URL (setup only).")
        conn.execute(f'CREATE DATABASE "{dbname}"')

    db_url = _with(base, dbname=dbname)
    env = {
        key: value
        for key, value in os.environ.items()
        # lib/auth.ts reads these before DATABASE_URL (SYSTEM_REFERENCE.md 4.2).
        if key not in {"POSTGRES_URL", "POSTGRESQL_URL", "PGDATABASE_URL"}
    }
    env.update({"DATABASE_URL": db_url, "PGSSL_CA": "", "PGSSL_SERVERNAME": ""})

    try:
        # Built as production was: Better Auth first, then the API tables, all
        # owned by the superuser, so roles.sql's ownership loop has work to do.
        _run(["node", "scripts/better-auth-migrate.mjs", "--apply"], cwd=WEB, env=env)
        _run([sys.executable, "scripts/create_tables.py"], cwd=BACKEND, env=env)
        _run([sys.executable, "-m", "alembic", "stamp", "head"], cwd=BACKEND, env=env)

        c = Cluster(superuser_url=db_url)
        with c.superuser() as conn, conn.transaction():
            c.admin_id = _seed_user(
                conn,
                role="admin",
                email="admin@test.carabao",
                phone=ADMIN_PHONE,
                two_factor=True,
            )
            c.pending_admin_id = _seed_user(
                conn, role="admin", email="pending@test.carabao"
            )
            c.unaccepted_admin_id = _seed_user(
                conn, role="admin", email="unaccepted@test.carabao", password=False
            )
            c.buyer_id = _seed_user(
                conn, role="user", email="buyer@test.carabao", phone=BUYER_PHONE
            )
            c.banned_buyer_id = _seed_user(
                conn, role="user", email="banned@test.carabao", banned=True
            )
            c.two_factor_buyer_id = _seed_user(
                conn, role="user", email="tfa-buyer@test.carabao", two_factor=True
            )
            now = _now()
            for identifier, value in (
                (f"admin-2fa-enrol-{c.admin_id}", "token-hash"),
                (f"admin-invite-code-{c.admin_id}", "code-hash:0"),
                (f"reset-password:{_id()}", c.admin_id),
                (f"trust-device-{_id()}", c.admin_id),
            ):
                conn.execute(
                    'INSERT INTO "verification" (id, identifier, value, "expiresAt", '
                    '"createdAt", "updatedAt") VALUES (%s, %s, %s, %s, %s, %s)',
                    (_id(), identifier, value, now + timedelta(hours=1), now, now),
                )

        with c.superuser() as conn:
            for path in (ROLES_SQL, GUARDS_SQL, ROLES_SQL, GUARDS_SQL):
                conn.execute(path.read_text(encoding="utf-8"))
            for login in SERVICE_LOGINS:
                password = secrets.token_urlsafe(18)
                conn.execute(
                    psycopg.sql.SQL("ALTER ROLE {} PASSWORD {}").format(
                        psycopg.sql.Identifier(login), psycopg.sql.Literal(password)
                    )
                )
                c.urls[login] = _with(db_url, user=login, password=password)
        yield c
    finally:
        with psycopg.connect(base, autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')


def refused(conn, sql: str, params: tuple | None = None) -> None:
    """The statement fails with 42501: no privilege, a row-level security
    WITH CHECK, a guard trigger, or "must be owner"."""
    with pytest.raises(errors.InsufficientPrivilege):
        conn.execute(sql, params)
    conn.rollback()


def affects_nothing(conn, sql: str, params: tuple | None = None) -> None:
    """Row-level security hides the row: no error, nothing changed."""
    cur = conn.execute(sql, params)
    assert cur.rowcount == 0
    conn.rollback()


def rows(conn, sql: str, params: tuple | None = None) -> list[tuple]:
    result = conn.execute(sql, params).fetchall()
    conn.rollback()
    return result


def _verification_insert(identifier: str, value: str) -> tuple[str, tuple]:
    now = _now()
    return (
        'INSERT INTO "verification" (id, identifier, value, "expiresAt", '
        '"createdAt", "updatedAt") VALUES (%s, %s, %s, %s, %s, %s)',
        (_id(), identifier, value, now + timedelta(minutes=10), now, now),
    )


# ── The logins themselves ───────────────────────────────────────────────────


def test_logins_and_ownership(cluster: Cluster) -> None:
    with cluster.superuser() as conn:
        roles = dict(
            (row[0], row[1:])
            for row in conn.execute(
                "SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, "
                "rolcreatedb, rolcanlogin FROM pg_roles "
                "WHERE rolname LIKE 'carabao\\_%'"
            )
        )
        for login in (OWNER, *SERVICE_LOGINS):
            assert roles[login][:4] == (False, False, False, False), login
        assert roles[OWNER][4] is False, "carabao_owner is NOLOGIN"

        memberships = conn.execute(
            "SELECT count(*) FROM pg_auth_members am JOIN pg_roles u "
            "ON u.oid = am.member WHERE u.rolname LIKE 'carabao\\_%'"
        ).fetchone()[0]
        assert memberships == 0

        not_owned = conn.execute(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n "
            "ON n.oid = c.relnamespace WHERE n.nspname = 'public' "
            "AND c.relkind IN ('r', 'p', 'S', 'v', 'm') "
            "AND pg_get_userbyid(c.relowner) <> 'carabao_owner'"
        ).fetchall()
        assert not_owned == []

        for login in SERVICE_LOGINS:
            can_create = conn.execute(
                "SELECT has_schema_privilege(%s, 'public', 'CREATE')", (login,)
            ).fetchone()[0]
            assert can_create is False, login


def test_superuser_still_works(cluster: Cluster) -> None:
    """Rollback is a variable change: the guards let the superuser through."""
    with cluster.superuser() as conn, conn.transaction(force_rollback=True):
        conn.execute(
            'UPDATE "user" SET banned = false, "twoFactorEnabled" = false '
            "WHERE id = %s",
            (cluster.admin_id,),
        )
        assert (
            conn.execute(
                'SELECT count(*) FROM "account" WHERE "userId" = %s',
                (cluster.admin_id,),
            ).fetchone()[0]
            == 1
        )


# ── carabao_web_public: must fail ───────────────────────────────────────────


def test_web_public_cannot_touch_roles_bans_or_2fa(cluster: Cluster) -> None:
    with cluster.connect(WEB_PUBLIC) as conn:
        refused(
            conn,
            'UPDATE "user" SET role = %s WHERE id = %s',
            ("admin", cluster.buyer_id),
        )
        now = _now()
        refused(
            conn,
            'INSERT INTO "user" (id, name, email, "emailVerified", role, '
            '"createdAt", "updatedAt") VALUES (%s, %s, %s, false, %s, %s, %s)',
            (_id(), "x", "sneaky@test.carabao", "admin", now, now),
        )
        refused(
            conn,
            'INSERT INTO "user" (id, name, email, "emailVerified", role, banned, '
            '"createdAt", "updatedAt") VALUES (%s, %s, %s, false, %s, true, %s, %s)',
            (_id(), "x", "sneaky2@test.carabao", "user", now, now),
        )
        refused(
            conn,
            'UPDATE "user" SET banned = false WHERE id = %s',
            (cluster.banned_buyer_id,),
        )
        refused(
            conn,
            'UPDATE "user" SET "banReason" = NULL WHERE id = %s',
            (cluster.banned_buyer_id,),
        )
        # G1 for any account that has 2FA on.
        refused(
            conn,
            'UPDATE "user" SET "twoFactorEnabled" = false WHERE id = %s',
            (cluster.two_factor_buyer_id,),
        )
        # G2: an admin's row cannot be changed or deleted at all.
        affects_nothing(
            conn,
            'UPDATE "user" SET "twoFactorEnabled" = false WHERE id = %s',
            (cluster.admin_id,),
        )
        affects_nothing(
            conn, 'UPDATE "user" SET name = %s WHERE id = %s', ("x", cluster.admin_id)
        )
        affects_nothing(conn, 'DELETE FROM "user" WHERE id = %s', (cluster.admin_id,))


def test_web_public_cannot_see_admin_secrets(cluster: Cluster) -> None:
    admin = cluster.admin_id
    with cluster.connect(WEB_PUBLIC) as conn:
        # The admin's row itself is readable (sign-in lookups, email uniqueness).
        assert rows(conn, 'SELECT id FROM "user" WHERE id = %s', (admin,)) == [(admin,)]
        assert rows(conn, 'SELECT * FROM "account" WHERE "userId" = %s', (admin,)) == []
        assert rows(conn, 'SELECT * FROM "session" WHERE "userId" = %s', (admin,)) == []
        assert (
            rows(conn, 'SELECT * FROM "twoFactor" WHERE "userId" = %s', (admin,)) == []
        )
        affects_nothing(
            conn,
            'UPDATE "account" SET password = %s WHERE "userId" = %s',
            ("salt:evil", admin),
        )
        refused(conn, 'DELETE FROM "twoFactor" WHERE "userId" = %s', (admin,))
        refused(
            conn,
            'UPDATE "twoFactor" SET secret = %s WHERE "userId" = %s',
            ("evil", admin),
        )
        now = _now()
        refused(
            conn,
            'INSERT INTO "account" (id, "accountId", "providerId", "userId", '
            'password, "createdAt", "updatedAt") VALUES (%s, %s, %s, %s, %s, %s, %s)',
            (_id(), "google-1", "google", admin, None, now, now),
        )
        refused(
            conn,
            'INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt", '
            '"updatedAt") VALUES (%s, %s, %s, %s, %s, %s)',
            (_id(), _id(), admin, now + timedelta(days=1), now, now),
        )
    with cluster.superuser() as conn:
        stored = conn.execute(
            'SELECT password FROM "account" WHERE "userId" = %s', (admin,)
        ).fetchone()[0]
        assert stored != "salt:evil"


def test_web_public_verification_guard(cluster: Cluster) -> None:
    admin = cluster.admin_id
    with cluster.connect(WEB_PUBLIC) as conn:
        for sql, params in (
            _verification_insert(f"admin-2fa-enrol-{cluster.buyer_id}", "x"),
            _verification_insert(f"admin-invite-code-{cluster.buyer_id}", "x:0"),
            _verification_insert(f"reset-password:{_id()}", admin),
            _verification_insert(f"phone-number-reset-{ADMIN_PHONE}", "123456:0"),
            _verification_insert(f"trust-device-{_id()}", admin),
            _verification_insert(f"2fa-{_id()}", admin),
        ):
            refused(conn, sql, params)
        visible = rows(conn, 'SELECT identifier FROM "verification"')
        assert visible == [], "no admin token, code, reset or device row is visible"
        # Turning a buyer's row into an admin one is refused too.
        sql, params = _verification_insert(f"reset-password:{_id()}", cluster.buyer_id)
        conn.execute(sql, params)
        refused(
            conn,
            'UPDATE "verification" SET value = %s WHERE identifier = %s',
            (admin, params[1]),
        )


def test_web_public_cannot_reach_other_tables_or_the_guards(cluster: Cluster) -> None:
    with cluster.connect(WEB_PUBLIC) as conn:
        for table in (
            "jwks_admin",
            "payout_batches",
            "orders",
            "merchant_applications",
            "admin_audit_logs",
            "backend_users",
            "alembic_version",
        ):
            refused(conn, f'SELECT * FROM "{table}"')
        now = _now()
        refused(
            conn,
            'INSERT INTO "jwks_admin" (id, "publicKey", "privateKey", '
            '"createdAt") VALUES (%s, %s, %s, %s)',
            (_id(), "p", "k", now),
        )
        refused(conn, 'ALTER TABLE "user" DISABLE TRIGGER guard_user_write')
        refused(conn, 'ALTER TABLE "user" DISABLE ROW LEVEL SECURITY')
        refused(conn, 'DROP POLICY web_public_update ON "user"')
        refused(conn, "CREATE TABLE sneaky (id int)")
        refused(
            conn,
            "CREATE OR REPLACE FUNCTION public.is_admin(user_id text) "
            "RETURNS boolean LANGUAGE sql AS 'SELECT false'",
        )
        refused(conn, "SET ROLE carabao_owner")


# ── carabao_web_public: must work ───────────────────────────────────────────


def test_web_public_buyer_flows(cluster: Cluster) -> None:
    with cluster.connect(WEB_PUBLIC) as conn:
        now = _now()
        uid = _id()
        # Sign-up (Better Auth's admin plugin sends role 'user', banned false).
        conn.execute(
            'INSERT INTO "user" (id, name, email, "emailVerified", role, banned, '
            '"twoFactorEnabled", "createdAt", "updatedAt") '
            "VALUES (%s, %s, %s, false, 'user', false, false, %s, %s)",
            (uid, "New Buyer", "new@test.carabao", now, now),
        )
        conn.execute(
            'INSERT INTO "account" (id, "accountId", "providerId", "userId", '
            'password, "createdAt", "updatedAt") VALUES (%s, %s, %s, %s, %s, %s, %s)',
            (_id(), uid, "credential", uid, "salt:hash", now, now),
        )
        token = _id()
        conn.execute(
            'INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt", '
            '"updatedAt") VALUES (%s, %s, %s, %s, %s, %s)',
            (_id(), token, uid, now + timedelta(days=1), now, now),
        )
        # Sign-in lookups, email uniqueness (sees every row, admins too).
        assert (
            conn.execute(
                'SELECT count(*) FROM "user" WHERE lower(email) = %s',
                ("admin@test.carabao",),
            ).fetchone()[0]
            == 1
        )
        assert (
            conn.execute(
                'SELECT password FROM "account" WHERE "userId" = %s', (uid,)
            ).fetchone()[0]
            == "salt:hash"
        )
        # Session refresh, profile update, email verification.
        conn.execute(
            'UPDATE "session" SET "expiresAt" = %s WHERE token = %s',
            (now + timedelta(days=7), token),
        )
        conn.execute(
            'UPDATE "user" SET name = %s, "emailVerified" = true, '
            '"updatedAt" = %s WHERE id = %s',
            ("Renamed", now, uid),
        )
        # Password reset (email and SMS) for a buyer.
        sql, params = _verification_insert(f"reset-password:{_id()}", uid)
        conn.execute(sql, params)
        conn.execute(
            'UPDATE "account" SET password = %s WHERE "userId" = %s', ("salt:new", uid)
        )
        conn.execute('DELETE FROM "verification" WHERE identifier = %s', (params[1],))
        sql, params = _verification_insert(f"phone-number-reset-{BUYER_PHONE}", "1:0")
        conn.execute(sql, params)
        sql, params = _verification_insert(f"phone-number-otp-{BUYER_PHONE}", "1:0")
        conn.execute(sql, params)
        conn.execute(
            'UPDATE "verification" SET value = %s WHERE identifier = %s',
            ("2:0", params[1]),
        )
        # Better Auth's periodic cleanup of expired rows: no error.
        conn.execute('DELETE FROM "verification" WHERE "expiresAt" < %s', (now,))
        # A non-admin's twoFactor rows are readable.
        conn.execute(
            'SELECT * FROM "twoFactor" WHERE "userId" = %s',
            (cluster.two_factor_buyer_id,),
        )
        # Rate limits and the public JWT keys.
        conn.execute(
            'INSERT INTO "rateLimit" (id, key, count, "lastRequest") '
            "VALUES (%s, %s, 1, %s)",
            (_id(), "ip:/sign-in", 1),
        )
        conn.execute(
            'UPDATE "rateLimit" SET count = 2 WHERE key = %s', ("ip:/sign-in",)
        )
        conn.execute(
            'INSERT INTO "jwks" (id, "publicKey", "privateKey", "createdAt") '
            "VALUES (%s, %s, %s, %s)",
            (_id(), "pub", "priv", now),
        )
        conn.execute('SELECT * FROM "jwks"')
        # Sign-out, account delete (sessions and accounts cascade).
        conn.execute('DELETE FROM "session" WHERE token = %s', (token,))
        conn.execute('DELETE FROM "user" WHERE id = %s', (uid,))
        conn.rollback()


# ── carabao_web_admin ───────────────────────────────────────────────────────


def test_web_admin_must_fail(cluster: Cluster) -> None:
    admin = cluster.admin_id
    with cluster.connect(WEB_ADMIN) as conn:
        for table in (
            "jwks",
            "payout_batches",
            "orders",
            "merchant_applications",
            "admin_audit_logs",
            "backend_users",
        ):
            refused(conn, f'SELECT * FROM "{table}"')
        refused(conn, 'UPDATE "user" SET role = %s WHERE id = %s', ("user", admin))
        refused(
            conn,
            'UPDATE "user" SET role = %s WHERE id = %s',
            ("admin", cluster.buyer_id),
        )
        refused(
            conn, 'UPDATE "user" SET banned = true WHERE id = %s', (cluster.buyer_id,)
        )
        refused(
            conn,
            'UPDATE "user" SET banned = false WHERE id = %s',
            (cluster.banned_buyer_id,),
        )
        refused(
            conn, 'UPDATE "user" SET "twoFactorEnabled" = false WHERE id = %s', (admin,)
        )
        now = _now()
        refused(
            conn,
            'INSERT INTO "user" (id, name, email, "emailVerified", role, '
            '"createdAt", "updatedAt") VALUES (%s, %s, %s, false, %s, %s, %s)',
            (_id(), "x", "x@test.carabao", "user", now, now),
        )
        refused(
            conn,
            'INSERT INTO "account" (id, "accountId", "providerId", "userId", '
            'password, "createdAt", "updatedAt") VALUES (%s, %s, %s, %s, %s, %s, %s)',
            (
                _id(),
                cluster.pending_admin_id,
                "credential",
                cluster.pending_admin_id,
                "salt:x",
                now,
                now,
            ),
        )
        # Setup tokens: read and delete only.
        sql, params = _verification_insert(
            f"admin-2fa-enrol-{cluster.pending_admin_id}", "planted"
        )
        refused(conn, sql, params)
        refused(
            conn,
            'UPDATE "verification" SET value = %s WHERE identifier = %s',
            ("planted", f"admin-2fa-enrol-{admin}"),
        )
        # Nor turn a row it made into one.
        sql, params = _verification_insert(f"trust-device-{_id()}", admin)
        conn.execute(sql, params)
        refused(
            conn,
            'UPDATE "verification" SET identifier = %s WHERE identifier = %s',
            (f"admin-2fa-enrol-{cluster.pending_admin_id}", params[1]),
        )
        # Invite codes: no access at all.
        code_id = f"admin-invite-code-{admin}"
        assert (
            rows(conn, 'SELECT * FROM "verification" WHERE identifier = %s', (code_id,))
            == []
        )
        sql, params = _verification_insert(
            f"admin-invite-code-{cluster.pending_admin_id}", "x:0"
        )
        refused(conn, sql, params)
        affects_nothing(
            conn,
            'UPDATE "verification" SET value = %s WHERE identifier = %s',
            ("x:0", code_id),
        )
        affects_nothing(
            conn, 'DELETE FROM "verification" WHERE identifier = %s', (code_id,)
        )
        refused(conn, 'ALTER TABLE "verification" DISABLE ROW LEVEL SECURITY')
        refused(conn, "CREATE TABLE sneaky (id int)")


def test_web_admin_must_work(cluster: Cluster) -> None:
    admin = cluster.admin_id
    pending = cluster.pending_admin_id
    with cluster.connect(WEB_ADMIN) as conn:
        now = _now()
        # Sign-in, session refresh, sign-out.
        conn.execute(
            'SELECT * FROM "user" WHERE lower(email) = %s', ("admin@test.carabao",)
        )
        conn.execute('SELECT password FROM "account" WHERE "userId" = %s', (admin,))
        token = _id()
        conn.execute(
            'INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt", '
            '"updatedAt", "mfaVerified") VALUES (%s, %s, %s, %s, %s, %s, true)',
            (_id(), token, admin, now + timedelta(days=1), now, now),
        )
        conn.execute(
            'UPDATE "session" SET "expiresAt" = %s WHERE token = %s',
            (now + timedelta(days=2), token),
        )
        conn.execute('DELETE FROM "session" WHERE token = %s', (token,))
        # Password change.
        cur = conn.execute(
            'UPDATE "account" SET password = %s, "updatedAt" = %s WHERE "userId" = %s',
            ("salt:changed", now, admin),
        )
        assert cur.rowcount == 1
        # The two-factor sign-in step and a trusted device.
        for prefix in ("2fa-", "trust-device-"):
            sql, params = _verification_insert(f"{prefix}{_id()}", admin)
            conn.execute(sql, params)
        # A password reset on the admin site.
        sql, params = _verification_insert(f"reset-password:{_id()}", admin)
        conn.execute(sql, params)
        # TOTP setup: read the setup token, write twoFactor, turn 2FA on,
        # delete the token.
        enrol = f"admin-2fa-enrol-{admin}"
        assert rows(
            conn, 'SELECT value FROM "verification" WHERE identifier = %s', (enrol,)
        ) == [("token-hash",)]
        conn.execute(
            'INSERT INTO "twoFactor" (id, secret, "backupCodes", "userId") '
            "VALUES (%s, %s, %s, %s)",
            (_id(), "s", "c", pending),
        )
        conn.execute(
            'UPDATE "twoFactor" SET secret = %s WHERE "userId" = %s', ("s2", pending)
        )
        cur = conn.execute(
            'UPDATE "user" SET "twoFactorEnabled" = true, '
            '"updatedAt" = %s WHERE id = %s',
            (now, pending),
        )
        assert cur.rowcount == 1
        cur = conn.execute('DELETE FROM "verification" WHERE identifier = %s', (enrol,))
        assert cur.rowcount == 1
        # Expired-row cleanup: no error.
        conn.execute('DELETE FROM "verification" WHERE "expiresAt" < %s', (now,))
        # First key in jwks_admin, rate limits.
        conn.execute(
            'INSERT INTO "jwks_admin" (id, "publicKey", "privateKey", '
            '"createdAt") VALUES (%s, %s, %s, %s)',
            (_id(), "p", "k", now),
        )
        conn.execute('SELECT * FROM "jwks_admin"')
        conn.execute(
            'INSERT INTO "rateLimit" (id, key, count, "lastRequest") '
            "VALUES (%s, %s, 1, %s)",
            (_id(), "ip:/admin", 1),
        )
        conn.rollback()


# ── carabao_api ─────────────────────────────────────────────────────────────


def test_api_must_fail(cluster: Cluster) -> None:
    with cluster.connect(API) as conn:
        refused(conn, 'SELECT * FROM "jwks"')
        refused(conn, 'SELECT * FROM "jwks_admin"')
        refused(conn, 'SELECT * FROM "rateLimit"')
        # Nobody is promoted, so the API has no UPDATE on "user".role.
        refused(
            conn,
            'UPDATE "user" SET role = %s WHERE id = %s',
            ("admin", cluster.buyer_id),
        )
        refused(
            conn,
            'UPDATE "account" SET password = %s WHERE "userId" = %s',
            ("salt:x", cluster.admin_id),
        )
        refused(conn, 'ALTER TABLE "user" DISABLE TRIGGER guard_user_write')
        refused(conn, "CREATE TABLE sneaky (id int)")


@pytest.fixture(scope="module")
def api_services(cluster: Cluster):
    """The backend's own code, on an engine that logs in as carabao_api."""
    os.environ["DATABASE_URL"] = cluster.urls[API]
    os.environ["APP_ENV"] = "development"
    os.environ.pop("RESEND_KEY", None)
    if str(BACKEND) not in sys.path:
        sys.path.insert(0, str(BACKEND))

    import importlib
    import pkgutil

    import app.models as models_pkg

    for module in pkgutil.iter_modules(models_pkg.__path__):
        importlib.import_module(f"{models_pkg.__name__}.{module.name}")

    from sqlalchemy.orm import sessionmaker

    from app.core.database_url import create_db_engine

    engine = create_db_engine(cluster.urls[API])
    yield sessionmaker(autocommit=False, autoflush=False, bind=engine)
    engine.dispose()


def _request():
    from starlette.requests import Request

    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/admin/invites/accept",
            "headers": [],
            "client": ("127.0.0.1", 50000),
            "query_string": b"",
        }
    )


def test_api_admin_account_flows(cluster: Cluster, api_services, monkeypatch) -> None:
    from fastapi import HTTPException
    from sqlalchemy import text

    from app.models.auth_identity import AuthIdentity
    from app.models.user import User
    from app.services import admin_accounts, admin_enrolment, better_auth_store

    sent: list[str] = []
    monkeypatch.setattr(
        admin_accounts, "_send_invite", lambda email, url, invited_by: sent.append(url)
    )
    monkeypatch.setattr(admin_enrolment, "deliver", lambda user, token: ["email"])

    def token_of(url: str) -> str:
        return url.split("token=", 1)[1]

    with api_services() as db:
        who, is_super, bypass = db.execute(
            text(
                "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles "
                "WHERE rolname = current_user"
            )
        ).one()
        assert (who, is_super, bypass) == (API, False, False)

        actor = User(external_auth_id=cluster.admin_id, notifications_preferences={})
        db.add(actor)
        db.commit()

        # Invite, then resend: the first link stops working.
        issued = admin_accounts.invite(
            db, actor=actor, email="new.admin@test.carabao", name="New Admin"
        )
        invitee = issued.user
        invite_id = invitee.external_auth_id
        first_token = token_of(sent[-1])
        issued = admin_accounts.resend(db, actor=actor, user=invitee)
        token = token_of(sent[-1])
        password = "Correct-Horse-9-Battery"
        with pytest.raises(HTTPException):
            admin_accounts.accept(
                db,
                _request(),
                invite_id=invite_id,
                token=first_token,
                code=issued.code,
                password=password,
            )
        # A wrong code counts (FOR UPDATE on the code row), the right one works.
        with pytest.raises(HTTPException):
            admin_accounts.accept(
                db,
                _request(),
                invite_id=invite_id,
                token=token,
                code="AAAA-AAAA",
                password=password,
            )
        value, _ = better_auth_store.verification_row(
            db, better_auth_store.invite_code_identifier(invite_id)
        )
        assert value.endswith(":1")
        db.rollback()
        admin_accounts.accept(
            db,
            _request(),
            invite_id=invite_id,
            token=token,
            code=issued.code,
            password=password,
        )
        assert better_auth_store.has_credential_account(db, invite_id)

        # TOTP setup is done by web-admin's login; then the API records it.
        assert admin_accounts.record_enrolled(db, invite_id) is False
        with cluster.connect(WEB_ADMIN) as web_admin:
            web_admin.execute(
                'UPDATE "user" SET "twoFactorEnabled" = true WHERE id = %s',
                (invite_id,),
            )
            web_admin.commit()
        assert admin_accounts.record_enrolled(db, invite_id) is True

        # Deactivate (locks the active admins FOR UPDATE) and reactivate.
        admin_accounts.deactivate(db, actor=actor, user=invitee)
        identity = db.get(AuthIdentity, invite_id)
        db.refresh(identity)
        assert identity.banned is True and identity.two_factor_enabled is False
        admin_accounts.reactivate(db, actor=actor, user=invitee)
        db.refresh(identity)
        assert identity.banned is False

        # 2FA reset (the route's two store calls).
        better_auth_store.clear_two_factor(db, invite_id)
        admin_enrolment.issue(db, invitee)
        db.commit()

        # A second invite locked by five wrong codes: both rows go.
        locked = admin_accounts.invite(
            db, actor=actor, email="locked@test.carabao", name="Locked"
        )
        locked_id = locked.user.external_auth_id
        locked_token = token_of(sent[-1])
        for _ in range(admin_accounts.MAX_CODE_ATTEMPTS):
            with pytest.raises(HTTPException):
                admin_accounts.accept(
                    db,
                    _request(),
                    invite_id=locked_id,
                    token=locked_token,
                    code="AAAA-AAAA",
                    password=password,
                )
        assert (
            better_auth_store.verification_row(
                db, better_auth_store.invite_code_identifier(locked_id)
            )
            is None
        )
        assert (
            better_auth_store.verification_row(
                db, better_auth_store.enrolment_identifier(locked_id)
            )
            is None
        )
        db.rollback()

        # Buyer ban / unban (sessions end), avatar, account delete.
        better_auth_store.set_banned(db, cluster.buyer_id, banned=True, reason="test")
        better_auth_store.set_banned(db, cluster.buyer_id, banned=False, reason=None)
        better_auth_store.set_image(db, cluster.buyer_id, "https://img.test/a.png")
        better_auth_store.delete_identity(db, cluster.two_factor_buyer_id)
        db.commit()

    with cluster.superuser() as conn:
        assert (
            conn.execute(
                'SELECT count(*) FROM "user" WHERE id = %s',
                (cluster.two_factor_buyer_id,),
            ).fetchone()[0]
            == 0
        )
        assert (
            conn.execute(
                'SELECT count(*) FROM "session" WHERE "userId" = %s',
                (cluster.buyer_id,),
            ).fetchone()[0]
            == 0
        )
        actions = [
            row[0]
            for row in conn.execute("SELECT action FROM admin_audit_logs ORDER BY id")
        ]
        for action in (
            "admin.invite",
            "admin.invite_resent",
            "admin.invite_accepted",
            "admin.two_factor_enrolled",
            "admin.deactivate",
            "admin.reactivate",
            "admin.invite_locked",
        ):
            assert action in actions


def test_api_make_admin_script(cluster: Cluster, api_services) -> None:
    from app.models.auth_identity import AuthIdentity
    from app.services import better_auth_store

    sys.path.insert(0, str(BACKEND / "scripts"))
    try:
        import make_admin
    finally:
        sys.path.remove(str(BACKEND / "scripts"))

    with api_services() as db:
        make_admin.create_admin(
            db,
            email="script.admin@test.carabao",
            name="Script Admin",
            password="Correct-Horse-9-Battery",
        )
        identity = (
            db.query(AuthIdentity)
            .filter(AuthIdentity.email == "script.admin@test.carabao")
            .one()
        )
        assert better_auth_store.has_credential_account(db, identity.id)
        make_admin.recover_admin(db, identity, password=None)

        # An admin who never accepted the invite: --recover also sets a password.
        unaccepted = db.get(AuthIdentity, cluster.unaccepted_admin_id)
        assert not better_auth_store.has_credential_account(db, unaccepted.id)
        make_admin.recover_admin(db, unaccepted, password="Correct-Horse-9-Battery")
        assert better_auth_store.has_credential_account(db, unaccepted.id)
        with pytest.raises(SystemExit):
            make_admin.recover_admin(
                db, db.get(AuthIdentity, cluster.buyer_id), password=None
            )
