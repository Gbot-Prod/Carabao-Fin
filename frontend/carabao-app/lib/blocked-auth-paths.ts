// BetterAuth's admin plugin stays on for what it enforces at sign-in (banned users
// get no session) and for the role/banned columns the backend writes. Its HTTP
// endpoints (/api/auth/admin/*: impersonate, set-password, remove-user, ban,
// set-role, ...) are closed: they would skip the FastAPI admin API's 2FA
// requirement, audit log and backend state. Admin actions go through FastAPI only.
//
// Kept free of imports so `npm test` can load it with Node's runner.

export const AUTH_BASE_PATH = "/api/auth";

/** True for any request path under the admin plugin's endpoints. */
export function isBlockedAuthPath(pathname: string, basePath = AUTH_BASE_PATH): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed escapes: check the raw path.
  }
  // Collapse "//" and drop a trailing slash so spelling tricks can't slip past.
  path = path.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const admin = `${basePath.toLowerCase()}/admin`;
  return path === admin || path.startsWith(`${admin}/`);
}
