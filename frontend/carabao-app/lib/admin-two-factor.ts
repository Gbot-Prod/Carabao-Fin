// Admin two-step verification rules (CF-0017, CF-0018) that lib/auth.ts uses.
// Plain functions with no "@/" imports, so `node --test` can run the tests.

import { createHash, timingSafeEqual } from "node:crypto";

// ── Enrolment links (CF-0018) ─────────────────────────────────────────────
// The backend makes a one-time token when an admin promotes a user or resets
// an admin's 2FA (backend/app/services/admin_enrolment.py). It keeps only the
// SHA-256 in BetterAuth's "verification" table under this identifier.

export const ENROLMENT_IDENTIFIER_PREFIX = "admin-2fa-enrol-";

/** The client sends the token from the link in this header on /two-factor/enable. */
export const ENROLMENT_TOKEN_HEADER = "x-admin-enrol-token";

/** Keep in step with better_auth_store.enrolment_identifier() in the backend. */
export const enrolmentIdentifier = (userId: string) => `${ENROLMENT_IDENTIFIER_PREFIX}${userId}`;

/** The account a setup token belongs to, from its "verification" identifier. */
export const enrolmentOwner = (identifier: string): string | null =>
  identifier.startsWith(ENROLMENT_IDENTIFIER_PREFIX) ? identifier.slice(ENROLMENT_IDENTIFIER_PREFIX.length) : null;

export type EnrolmentLinkState = "ok" | "replaced" | "expired" | "other-account";

/**
 * What the setup page tells the user about a link, from the stored row that
 * has the token's hash (null when no row has it: a newer link replaced it, or
 * setup finished and used it).
 */
export function enrolmentLinkState(
  row: { identifier: string; expiresAt: Date | string } | null | undefined,
  userId: string,
  now: Date = new Date(),
): EnrolmentLinkState {
  if (!row) return "replaced";
  if (enrolmentOwner(row.identifier) !== userId) return "other-account";
  if (new Date(row.expiresAt).getTime() <= now.getTime()) return "expired";
  return "ok";
}

/** Keep in step with admin_enrolment.hash_token() in the backend. */
export const hashEnrolmentToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** True if `token` is the one whose hash is stored and the row has not expired. */
export function enrolmentTokenMatches(
  token: string | null | undefined,
  stored: { value: string; expiresAt: Date | string } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!token || !stored) return false;
  if (new Date(stored.expiresAt).getTime() <= now.getTime()) return false;
  const given = Buffer.from(hashEnrolmentToken(token));
  const expected = Buffer.from(stored.value);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ── Sessions that passed the TOTP step (CF-0017) ──────────────────────────

/** The plugin's own password sign-ins. It asks for the code on these, and
 * deletes the new session unless the device was trusted after an earlier code. */
export const PASSWORD_SIGN_IN_PATHS = ["/sign-in/email", "/sign-in/username", "/sign-in/phone-number"];

/** Endpoints that make a session only after a correct code. */
export const SECOND_FACTOR_PATHS = ["/two-factor/verify-totp", "/two-factor/verify-backup-code"];

/**
 * Whether a session made on `path` counts as having passed the TOTP step
 * (the session's mfaVerified field, sent to the backend as the "mfa" claim).
 * A Google or Facebook sign-in, an email-link sign-in and a phone-code signup
 * do not count.
 */
export function sessionPassedTotp(path: string | undefined, twoFactorEnabled: boolean): boolean {
  if (!path) return false;
  if (SECOND_FACTOR_PATHS.includes(path)) return true;
  // The session survives only when a trusted-device cookie was valid, and
  // that device was trusted after a correct code.
  return twoFactorEnabled && PASSWORD_SIGN_IN_PATHS.includes(path);
}

/** Endpoints that show or replace the TOTP secret or backup codes. Only a
 * session that passed the TOTP step may use them. */
export const TOTP_SECRET_PATHS = ["/two-factor/get-totp-uri", "/two-factor/generate-backup-codes"];

// ── The mobile app ───────────────────────────────────────────────────────
// Admins sign in on the website only. The Expo client sends its app scheme
// in "expo-origin" (the @better-auth/expo plugin copies it to Origin).

const MOBILE_ORIGIN_PREFIXES = ["carabaomobile://", "exp://"];

export function isMobileRequest(headers: Headers | null | undefined): boolean {
  if (!headers) return false;
  if (headers.get("expo-origin")) return true;
  const origin = headers.get("origin") ?? "";
  return MOBILE_ORIGIN_PREFIXES.some((prefix) => origin.startsWith(prefix));
}
