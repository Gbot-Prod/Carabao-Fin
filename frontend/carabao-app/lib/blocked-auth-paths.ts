// BetterAuth's admin plugin stays on for what it enforces at sign-in (banned users
// get no session) and for the role/banned columns the backend writes. Its HTTP
// endpoints (/api/auth/admin/*: impersonate, set-password, remove-user, ban,
// set-role, ...) are closed: they would skip the FastAPI admin API's 2FA
// requirement, audit log and backend state. Admin actions go through FastAPI only.
//
// Kept free of imports so `npm test` can load it with Node's runner.

export const AUTH_BASE_PATH = "/api/auth";

function normalize(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed escapes: check the raw path.
  }
  // Collapse "//" and drop a trailing slash so spelling tricks can't slip past.
  return path.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** True for any request path under the admin plugin's endpoints. */
export function isBlockedAuthPath(pathname: string, basePath = AUTH_BASE_PATH): boolean {
  return under(normalize(pathname), `${basePath.toLowerCase()}/admin`);
}

// The admin deploy (APP_SURFACE=admin) opens only what its pages use: email +
// password sign-in, the TOTP steps, password reset by email, sessions and
// tokens. No sign-up, no phone, no Google/Facebook, no mobile.
const ADMIN_SURFACE_ENDPOINTS = [
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/token",
  "/jwks",
  "/two-factor",
  "/request-password-reset",
  "/reset-password",
  "/change-password",
  // Profile page: whether the account has a password (read-only, own account).
  "/list-accounts",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/ok",
  "/error",
];

/** True for a Better Auth path that the admin deploy does not serve. */
export function isBlockedOnAdminSurface(pathname: string, basePath = AUTH_BASE_PATH): boolean {
  const path = normalize(pathname);
  const base = basePath.toLowerCase();
  if (!under(path, base)) return false;
  if (isBlockedAuthPath(path, basePath)) return true;
  return !ADMIN_SURFACE_ENDPOINTS.some((endpoint) => under(path, `${base}${endpoint}`));
}
