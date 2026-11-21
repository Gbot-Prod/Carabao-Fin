// Cloudflare Turnstile on the public endpoints that send a code or a reset
// link (lib/auth.ts otpCaptcha). The web client gets a token per request
// (lib/turnstile.ts) and sends it in CAPTCHA_HEADER.
//
// Not yet: the mobile app (no widget there; its requests skip the check), and
// the signed-in FastAPI code routes (/sms/otp/send, /email/otp/send,
// /users/me/delete-code, /merchants/me/payout-info/code), which have per-user
// limits instead.
//
// Kept free of "@/" imports so `npm test` can load it with Node's runner.

export const CAPTCHA_HEADER = "x-captcha-response";

export const CAPTCHA_PATHS = [
  "/phone-number/send-otp",
  "/phone-number/request-password-reset",
  "/request-password-reset",
];

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const CAPTCHA_FAILED_MESSAGE = "We couldn't check that you're not a robot. Please try again.";

// Same spelling rules as lib/blocked-auth-paths.ts: decoded, lower case, no
// "//" or trailing slash, so a differently written path can't skip the check.
function normalize(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed escapes: check the raw path.
  }
  return path.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

/** True for a request path that needs a Turnstile token. */
export function needsCaptcha(pathname: string, basePath = "/api/auth"): boolean {
  const path = normalize(pathname);
  const base = basePath.toLowerCase();
  return CAPTCHA_PATHS.some((endpoint) => path === `${base}${endpoint}`);
}

export type CaptchaResult = "ok" | "failed" | "unavailable";

/** Checks a token with Cloudflare. "unavailable" when Cloudflare can't be reached. */
export async function verifyTurnstile({
  token,
  secret,
  remoteIp,
  fetchImpl = fetch,
  timeoutMs = 10_000,
}: {
  token: string;
  secret: string;
  remoteIp?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<CaptchaResult> {
  try {
    const res = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return "unavailable";
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? "ok" : "failed";
  } catch {
    return "unavailable";
  }
}
