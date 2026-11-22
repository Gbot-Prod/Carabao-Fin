// Shared with mobile/CarabaoMobile/src/lib/baseUrl.ts. Keep both copies the same (sharedCopies.test.ts).
// CF-0103: check the API and web base URLs before the app sends a token to them.
// Pure (no React Native imports) so `npm test` covers it. Regex, not `new URL()`:
// React Native's URL class does not implement `protocol` / `hostname` on every version.

// scheme://host[:port][/path] — no user:password@, no query, no fragment, no spaces.
const BASE_URL = /^(https?):\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:\d{1,5})?(\/[^\s?#@]*)?$/;

/**
 * The base URL with trailing slashes removed, or an Error that says why it is refused.
 * In a production build only https is allowed: the session token goes to these hosts.
 */
export function checkBaseUrl(name: string, raw: string, production: boolean): string {
  const value = raw.trim().replace(/\/+$/, '');
  const m = BASE_URL.exec(value);
  if (!m) {
    throw new Error(`${name} is not a valid http(s) base URL: "${value}". Use scheme://host[:port][/path].`);
  }
  if (production && m[1] !== 'https') {
    throw new Error(`${name} must use https in a production build (got "${value}"). Set it before the build.`);
  }
  return value;
}
