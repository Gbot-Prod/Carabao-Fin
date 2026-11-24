-- Guards inside the database (documentation/manuals/DB_ROLE_SPLIT_PLAN.md,
-- section 4). Run as a superuser AFTER roles.sql, and again after every
-- `npm run auth:migrate:apply`:
--
--   psql "$SUPERUSER_URL" -v ON_ERROR_STOP=1 -f backend/db/guards.sql
--
-- Safe to run again: functions are CREATE OR REPLACE, and every policy on the
-- guarded tables is dropped and made again, so a policy removed from this file
-- is also removed from the database.
--
-- Everything here is made by carabao_owner (SET ROLE below), so it owns the
-- functions, and only it (or a superuser) can drop or turn off a trigger or
-- row-level security. The web logins cannot remove the guards.
--
-- Each guard lets through carabao_api, carabao_owner and superusers. The
-- superuser exception is the rollback: a service pointed back at the
-- "postgres" login works with the guards in place.
--
-- IMPORTANT: G3 matches verification identifiers by their prefix. That works
-- only because lib/auth.ts stores identifiers in plain text: it sets no
-- verification.storeIdentifier and no secondaryStorage. If either is ever
-- turned on, identifiers become hashes or leave the table, and G3 silently
-- matches nothing. backend/tests_pg/test_db_roles.py catches it (an admin's
-- reset token insert must fail), so run it after any change there.

BEGIN;

SET LOCAL ROLE carabao_owner;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- The only SECURITY DEFINER functions: policies call them to read "user"
-- whatever the caller's own row-level security. An admin is role = 'admin',
-- banned or not, so a deactivated admin's rows stay protected.

CREATE OR REPLACE FUNCTION public.is_admin(user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."user" u WHERE u.id = user_id AND u.role = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_phone(phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."user" u WHERE u."phoneNumber" = phone AND u.role = 'admin'
  )
$$;

REVOKE ALL ON FUNCTION public.is_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin_phone(text) FROM PUBLIC;
-- Policies run their expressions as the caller, so the caller needs EXECUTE.
GRANT EXECUTE ON FUNCTION public.is_admin(text) TO carabao_web_public;
GRANT EXECUTE ON FUNCTION public.is_admin_phone(text) TO carabao_web_public;
-- The API's "account" delete policy (admin account reset).
GRANT EXECUTE ON FUNCTION public.is_admin(text) TO carabao_api;

-- Whether a verification row is one the public login may see or write (G3).
-- SECURITY INVOKER (the default): it only calls the two helpers above.
CREATE OR REPLACE FUNCTION public.public_may_use_verification(identifier text, value text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT
    -- Setup tokens and invite codes for admins come only from the API.
    identifier NOT LIKE 'admin-2fa-enrol-%'
    AND identifier NOT LIKE 'admin-invite-code-%'
    -- Email reset (better-auth 1.7.26 api/routes/password.mjs):
    -- identifier "reset-password:<token>", value = the user's id.
    AND NOT (identifier LIKE 'reset-password:%' AND public.is_admin(value))
    -- SMS reset (plugins/phone-number/routes.mjs):
    -- identifier "phone-number-reset-<phone>", value "<code>:<attempts>".
    AND NOT (identifier LIKE 'phone-number-reset-%'
             AND public.is_admin_phone(substr(identifier, length('phone-number-reset-') + 1)))
    -- Trusted devices and the two-factor sign-in step (plugins/two-factor):
    -- value = the user's id. Only the admin site has a reason to make these
    -- for an admin.
    AND NOT ((identifier LIKE 'trust-device-%' OR identifier LIKE '2fa-%')
             AND public.is_admin(value))
$$;

REVOKE ALL ON FUNCTION public.public_may_use_verification(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_may_use_verification(text, text) TO carabao_web_public;

-- ── G1. Role, ban and turning 2FA off belong to the API ────────────────────
-- SECURITY INVOKER on purpose: inside a SECURITY DEFINER function current_user
-- is the owner, so the check below would always pass. session_user is not
-- used: it ignores SET ROLE. Anyone not let through is checked, so a login
-- added later is guarded by default.

CREATE OR REPLACE FUNCTION public.guard_user_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_user IN ('carabao_api', 'carabao_owner')
     OR COALESCE((SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user), false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS NOT NULL AND NEW.role <> 'user' THEN
      RAISE EXCEPTION 'carabao guard G1: % may not create a user with role %', current_user, NEW.role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.banned IS TRUE THEN
      RAISE EXCEPTION 'carabao guard G1: % may not create a banned user', current_user
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.banned IS DISTINCT FROM OLD.banned
     OR NEW."banReason" IS DISTINCT FROM OLD."banReason"
     OR NEW."banExpires" IS DISTINCT FROM OLD."banExpires" THEN
    RAISE EXCEPTION 'carabao guard G1: % may not change role or ban', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."twoFactorEnabled" IS TRUE AND NEW."twoFactorEnabled" IS NOT TRUE THEN
    RAISE EXCEPTION 'carabao guard G1: % may not turn off two-step verification', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_user_write() FROM PUBLIC;

DROP TRIGGER IF EXISTS guard_user_write ON public."user";
CREATE TRIGGER guard_user_write
  BEFORE INSERT OR UPDATE ON public."user"
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_write();

-- ── Row-level security: start clean ─────────────────────────────────────────
-- Drop every policy on the guarded tables, so re-running gives exactly the
-- policies below. Not FORCE: the owner (migrations) is not subject to RLS,
-- and superusers never are.

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('user', 'account', 'session', 'twoFactor', 'verification')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END
$$;

ALTER TABLE public."user"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."account"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."session"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."twoFactor"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."verification" ENABLE ROW LEVEL SECURITY;

-- With RLS on, a login with no policy sees no rows. The API and the admin
-- login see every row (G4, the admin login kept off non-admin accounts, is for
-- later); their table grants (roles.sql) still limit what they can do.

CREATE POLICY api_all ON public."user"         FOR ALL TO carabao_api USING (true) WITH CHECK (true);
-- "account": the API reads and adds rows, and deletes only an admin's password
-- row (admin account reset, app/services/admin_accounts.py reset_account). It
-- never deletes a buyer's or merchant's password, and it has no UPDATE grant.
CREATE POLICY api_read ON public."account" FOR SELECT TO carabao_api USING (true);
CREATE POLICY api_insert ON public."account" FOR INSERT TO carabao_api WITH CHECK (true);
CREATE POLICY api_delete_admin_password ON public."account" FOR DELETE TO carabao_api
  USING ("providerId" = 'credential' AND public.is_admin("userId"));
CREATE POLICY api_all ON public."session"      FOR ALL TO carabao_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON public."twoFactor"    FOR ALL TO carabao_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON public."verification" FOR ALL TO carabao_api USING (true) WITH CHECK (true);

CREATE POLICY web_admin_all ON public."user"      FOR ALL TO carabao_web_admin USING (true) WITH CHECK (true);
CREATE POLICY web_admin_all ON public."account"   FOR ALL TO carabao_web_admin USING (true) WITH CHECK (true);
CREATE POLICY web_admin_all ON public."session"   FOR ALL TO carabao_web_admin USING (true) WITH CHECK (true);
CREATE POLICY web_admin_all ON public."twoFactor" FOR ALL TO carabao_web_admin USING (true) WITH CHECK (true);

-- ── G2. The public login cannot touch admin accounts ────────────────────────
-- Every "user" row is readable (email uniqueness and sign-in lookups), but an
-- admin's row cannot be changed or deleted, and no admin can be made (G1
-- refuses the role too).

CREATE POLICY web_public_select ON public."user" FOR SELECT TO carabao_web_public
  USING (true);
CREATE POLICY web_public_insert ON public."user" FOR INSERT TO carabao_web_public
  WITH CHECK (role IS DISTINCT FROM 'admin');
CREATE POLICY web_public_update ON public."user" FOR UPDATE TO carabao_web_public
  USING (role IS DISTINCT FROM 'admin')
  WITH CHECK (role IS DISTINCT FROM 'admin');
CREATE POLICY web_public_delete ON public."user" FOR DELETE TO carabao_web_public
  USING (role IS DISTINCT FROM 'admin');

-- An admin's password hash, sessions and TOTP secret are invisible to the
-- public deploy and cannot be written by it.
CREATE POLICY web_public_non_admin ON public."account" FOR ALL TO carabao_web_public
  USING (NOT public.is_admin("userId")) WITH CHECK (NOT public.is_admin("userId"));
CREATE POLICY web_public_non_admin ON public."session" FOR ALL TO carabao_web_public
  USING (NOT public.is_admin("userId")) WITH CHECK (NOT public.is_admin("userId"));
-- twoFactor: the public login has SELECT only (roles.sql).
CREATE POLICY web_public_non_admin ON public."twoFactor" FOR ALL TO carabao_web_public
  USING (NOT public.is_admin("userId")) WITH CHECK (NOT public.is_admin("userId"));

-- ── G3. Tokens and codes for admins come only from the API ──────────────────

CREATE POLICY web_public_non_admin ON public."verification" FOR ALL TO carabao_web_public
  USING (public.public_may_use_verification(identifier, value))
  WITH CHECK (public.public_may_use_verification(identifier, value));

-- The admin site reads the setup token (/two-factor/enable before-hook) and
-- deletes it (verify-totp after-hook), but never makes or changes one. It has
-- no access at all to invite codes: only the API checks them and counts
-- attempts.
CREATE POLICY web_admin_all ON public."verification" FOR ALL TO carabao_web_admin
  USING (identifier NOT LIKE 'admin-invite-code-%')
  WITH CHECK (identifier NOT LIKE 'admin-2fa-enrol-%'
              AND identifier NOT LIKE 'admin-invite-code-%');

COMMIT;
