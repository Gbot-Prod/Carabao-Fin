-- One Postgres login per service (documentation/manuals/DB_ROLE_SPLIT_PLAN.md,
-- sections 1, 3 and 6). Run as a superuser (Railway: "postgres"), BEFORE
-- guards.sql. Safe to run again: every step is idempotent.
--
--   psql "$SUPERUSER_URL" -v ON_ERROR_STOP=1 -f backend/db/roles.sql
--   psql "$SUPERUSER_URL" -v ON_ERROR_STOP=1 -f backend/db/guards.sql
--
-- No passwords in this file. The service logins are made without one, so they
-- cannot sign in until you set it. In the same psql session, as the superuser:
--
--   \password carabao_api
--   \password carabao_web_public
--   \password carabao_web_admin
--
-- (\password hashes the password in psql, so it is never in the shell
-- history or the server log.) carabao_owner is NOLOGIN: to run a migration,
-- ALTER ROLE carabao_owner LOGIN, \password carabao_owner, migrate, then
-- ALTER ROLE carabao_owner NOLOGIN.
--
-- The whole file is one transaction: if anything fails, nothing changes.

BEGIN;

-- ── 1. Logins ───────────────────────────────────────────────────────────────
-- Created only if missing. The ALTER ROLE below then pins the attributes on
-- every run (never superuser, never BYPASSRLS, no CREATEROLE / CREATEDB). It
-- does not touch LOGIN / NOLOGIN or passwords of existing roles.

DO $$
DECLARE
  r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'carabao_owner') THEN
    CREATE ROLE carabao_owner NOLOGIN;
  END IF;
  FOREACH r IN ARRAY ARRAY['carabao_api', 'carabao_web_public', 'carabao_web_admin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['carabao_owner', 'carabao_api', 'carabao_web_public', 'carabao_web_admin'] LOOP
    EXECUTE format(
      'ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT',
      r
    );
  END LOOP;
END
$$;

-- None of the four is a member of another (plan section 1). A membership
-- would let a web login act as the owner, who can drop the guards.
DO $$
DECLARE
  m record;
BEGIN
  FOR m IN
    SELECT g.rolname AS grp, u.rolname AS member
    FROM pg_auth_members am
    JOIN pg_roles g ON g.oid = am.roleid
    JOIN pg_roles u ON u.oid = am.member
    WHERE u.rolname IN ('carabao_owner', 'carabao_api', 'carabao_web_public', 'carabao_web_admin')
  LOOP
    EXECUTE format('REVOKE %I FROM %I', m.grp, m.member);
  END LOOP;
END
$$;

-- ── 2. Ownership ────────────────────────────────────────────────────────────
-- Everything in schema public moves to carabao_owner. REASSIGN OWNED BY
-- postgres can't be used (Postgres refuses it for the bootstrap superuser's
-- system objects), so this loops over the objects one by one. On an empty
-- database it does nothing.
--
-- Order: tables first (ALTER TABLE also moves the sequences a serial or
-- identity column owns, and ALTER SEQUENCE refuses those), then the sequences
-- left, then views, then enum and domain types.

DO $$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'f')
      AND pg_get_userbyid(c.relowner) <> 'carabao_owner'
  LOOP
    IF obj.relkind = 'f' THEN
      EXECUTE format('ALTER FOREIGN TABLE public.%I OWNER TO carabao_owner', obj.relname);
    ELSE
      EXECUTE format('ALTER TABLE public.%I OWNER TO carabao_owner', obj.relname);
    END IF;
  END LOOP;

  FOR obj IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND pg_get_userbyid(c.relowner) <> 'carabao_owner'
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO carabao_owner', obj.relname);
  END LOOP;

  FOR obj IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('v', 'm')
      AND pg_get_userbyid(c.relowner) <> 'carabao_owner'
  LOOP
    IF obj.relkind = 'm' THEN
      EXECUTE format('ALTER MATERIALIZED VIEW public.%I OWNER TO carabao_owner', obj.relname);
    ELSE
      EXECUTE format('ALTER VIEW public.%I OWNER TO carabao_owner', obj.relname);
    END IF;
  END LOOP;

  -- Enum and domain types (a table's row type and array types move with
  -- their table or base type).
  FOR obj IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype IN ('e', 'd')
      AND pg_get_userbyid(t.typowner) <> 'carabao_owner'
  LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO carabao_owner', obj.typname);
  END LOOP;

  -- Functions other than the guards (guards.sql makes those as the owner).
  FOR obj IN
    SELECT p.oid::regprocedure AS fn, p.prokind
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(p.proowner) <> 'carabao_owner'
      -- Functions that belong to an extension stay with it.
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    IF obj.prokind = 'p' THEN
      EXECUTE format('ALTER PROCEDURE %s OWNER TO carabao_owner', obj.fn);
    ELSE
      EXECUTE format('ALTER FUNCTION %s OWNER TO carabao_owner', obj.fn);
    END IF;
  END LOOP;
END
$$;

-- ── 3. Schema ───────────────────────────────────────────────────────────────
-- Only the owner makes tables. Postgres 15+ already gives PUBLIC no CREATE on
-- public; this makes sure of it on an older or changed database.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO carabao_owner;
GRANT USAGE ON SCHEMA public TO carabao_api, carabao_web_public, carabao_web_admin;
REVOKE CREATE ON SCHEMA public FROM carabao_api, carabao_web_public, carabao_web_admin;

-- The login can connect to this database (PUBLIC usually already can).
DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO carabao_api, carabao_web_public, carabao_web_admin',
    current_database()
  );
END
$$;

-- ── 4. Table access (plan section 3) ────────────────────────────────────────
-- Start from nothing on every table, then grant. Re-running the file gives the
-- same grants, so a grant removed here is also removed from the database.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON public.%I FROM PUBLIC, carabao_api, carabao_web_public, carabao_web_admin',
      t.relname
    );
  END LOOP;
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, carabao_api, carabao_web_public, carabao_web_admin',
      t.relname
    );
  END LOOP;
END
$$;

-- The Better Auth tables. Missing ones are skipped with a notice (an older
-- database may not have rateLimit yet); run auth:migrate:apply, then this file
-- and guards.sql again.
DO $$
DECLARE
  g text[];
  grants text[][] := ARRAY[
    -- table,          role,                 privileges
    ['user',          'carabao_web_public', 'SELECT, INSERT, UPDATE, DELETE'],
    ['session',       'carabao_web_public', 'SELECT, INSERT, UPDATE, DELETE'],
    ['account',       'carabao_web_public', 'SELECT, INSERT, UPDATE, DELETE'],
    ['verification',  'carabao_web_public', 'SELECT, INSERT, UPDATE, DELETE'],
    ['twoFactor',     'carabao_web_public', 'SELECT'],
    ['rateLimit',     'carabao_web_public', 'SELECT, INSERT, UPDATE, DELETE'],
    ['jwks',          'carabao_web_public', 'SELECT, INSERT'],

    ['user',          'carabao_web_admin',  'SELECT, UPDATE'],
    ['session',       'carabao_web_admin',  'SELECT, INSERT, UPDATE, DELETE'],
    ['account',       'carabao_web_admin',  'SELECT, UPDATE'],
    ['verification',  'carabao_web_admin',  'SELECT, INSERT, UPDATE, DELETE'],
    ['twoFactor',     'carabao_web_admin',  'SELECT, INSERT, UPDATE, DELETE'],
    ['rateLimit',     'carabao_web_admin',  'SELECT, INSERT, UPDATE, DELETE'],
    ['jwks_admin',    'carabao_web_admin',  'SELECT, INSERT'],

    -- The API (backend/app/services/better_auth_store.py is its only writer
    -- of these tables). "user" UPDATE is per column, below.
    ['user',          'carabao_api',        'SELECT, INSERT, DELETE'],
    ['session',       'carabao_api',        'SELECT, DELETE'],
    ['account',       'carabao_api',        'SELECT, INSERT'],
    ['verification',  'carabao_api',        'SELECT, INSERT, UPDATE, DELETE'],
    ['twoFactor',     'carabao_api',        'SELECT, DELETE']
  ];
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    IF to_regclass(format('public.%I', g[1])) IS NULL THEN
      RAISE NOTICE 'Table "%" does not exist yet; skipped its grant to %.', g[1], g[2];
      CONTINUE;
    END IF;
    EXECUTE format('GRANT %s ON public.%I TO %I', g[3], g[1], g[2]);
  END LOOP;

  -- The only "user" columns the API changes: ban and deactivation, 2FA reset,
  -- invite acceptance and the avatar. Never the role: admins are made as
  -- admins and nobody is promoted (plan section 2). UPDATE on a column is also
  -- what SELECT ... FOR UPDATE needs (lock_active_admins).
  IF to_regclass('public."user"') IS NOT NULL THEN
    GRANT UPDATE (banned, "banReason", "banExpires", "twoFactorEnabled",
                  "emailVerified", image, "updatedAt")
      ON public."user" TO carabao_api;
  END IF;
END
$$;

-- Business tables, audit tables and alembic_version: the API only. Every
-- table in public that is not a Better Auth table.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND c.relname NOT IN ('user', 'session', 'account', 'verification',
                            'twoFactor', 'rateLimit', 'jwks', 'jwks_admin')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO carabao_api', t.relname);
  END LOOP;
END
$$;

-- Sequences (serial and identity columns of the business tables).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO carabao_api;

-- ── 5. Default privileges ───────────────────────────────────────────────────
-- A table a migration (run as carabao_owner) makes later reaches the API on
-- its own. The web logins get nothing by default: a new Better Auth table
-- stays closed until this file grants it, which fails closed and loudly (a
-- sign-in error).

ALTER DEFAULT PRIVILEGES FOR ROLE carabao_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO carabao_api;
ALTER DEFAULT PRIVILEGES FOR ROLE carabao_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO carabao_api;
-- Functions the owner makes are not callable by everyone by default.
ALTER DEFAULT PRIVILEGES FOR ROLE carabao_owner IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
