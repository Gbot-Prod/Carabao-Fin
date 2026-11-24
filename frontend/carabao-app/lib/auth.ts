import { expo } from "@better-auth/expo";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import { admin, jwt, phoneNumber, twoFactor } from "better-auth/plugins";
import { deleteSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import type { GenericEndpointContext } from "@better-auth/core";
import { Pool } from "pg";
import * as z from "zod";
import { poolConfigFromUrl } from "@/lib/db-ssl.mjs";
import { AUTH_BASE_PATH, isBlockedAuthPath, isBlockedOnAdminSurface } from "@/lib/blocked-auth-paths";
import { appSurface, merchantUrl, rootDomain, subdomainMode } from "@/lib/urls";
import { PH_MOBILE_PATTERN, PHONE_PLACEHOLDER_EMAIL_DOMAIN, isPlaceholderEmail } from "@/lib/phone";
import {
  OTP_SEND_PATHS,
  adminResetWaitIdentifier,
  phoneOtpIdentifier,
  phoneResetIdentifier,
  resendWaitSeconds,
} from "@/lib/otp-cooldown";
import { authRateLimit } from "@/lib/auth-rate-limit";
import { CAPTCHA_FAILED_MESSAGE, CAPTCHA_HEADER, needsCaptcha, verifyTurnstile } from "@/lib/captcha";
import {
  ADMIN_PASSWORD_RULE_MESSAGE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULE_MESSAGE,
  isStrongAdminPassword,
  isStrongPassword,
} from "@/lib/password-policy";
import {
  ENROLMENT_TOKEN_HEADER,
  TOTP_SECRET_PATHS,
  enrolmentIdentifier,
  enrolmentTokenMatches,
  isMobileRequest,
  sessionPassedTotp,
} from "@/lib/admin-two-factor";

// The database pool, made on first use of `auth` (see the end of this file).
function createPool(): Pool {
  const rawPostgresUrl = process.env.DATABASE_URL;

  const normalizedPostgresUrl = rawPostgresUrl
    ? rawPostgresUrl.trim().replace(/^"|"$/g, "")
    : "";

  if (!normalizedPostgresUrl) {
    throw new Error(
      "Better Auth Postgres URL is missing. Set DATABASE_URL."
    );
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      const parsedUrl = new URL(normalizedPostgresUrl);
      const databaseName = parsedUrl.pathname.replace(/^\//, "") || "(none)";
      console.info(
        `[auth] Better Auth DB target host=${parsedUrl.hostname} db=${databaseName}`
      );
    } catch {
      console.info("[auth] Better Auth DB target could not be parsed");
    }
  }

  // CF-0001: the server cert is always verified; see lib/db-ssl.mjs for the env vars.
  return new Pool(poolConfigFromUrl(normalizedPostgresUrl));
}

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "";
const normalizedApiUrl = rawApiUrl.trim().replace(/^"|"$/g, "");
const apiBaseUrl = normalizedApiUrl
  ? normalizedApiUrl.startsWith("http")
    ? normalizedApiUrl
    : `https://${normalizedApiUrl}`
  : "";

// Better Auth rejects requests whose Origin isn't the baseURL origin or listed here ("Invalid origin").
// Normalize env values so quotes, trailing slashes, paths or a missing scheme don't break the match.
const toOrigin = (value: string | undefined) => {
  const trimmed = value?.trim().replace(/^"|"$/g, "");
  if (!trimmed) return null;
  try {
    return new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return null;
  }
};

const appBaseUrl =
  toOrigin(process.env.BETTER_AUTH_URL) ||
  toOrigin(process.env.NEXT_PUBLIC_APP_URL) ||
  "http://localhost:3000";

// ── Surfaces (documentation/manuals/SUBDOMAINS.md) ────────────────────────
//
// One code base, two deploys on the same database:
//   public (APP_SURFACE=public): carabao.<root> and merchant.<root>. Cookies
//     "carabao.*" on the root domain, so one sign-in works on both hosts.
//   admin (APP_SURFACE=admin): admin.<root>. Cookies "carabao-admin.*" on the
//     admin host only, so it never reads the shared cookie. Its own
//     BETTER_AUTH_SECRET (session signing, TOTP secrets, JWT private keys) and
//     its own JWT keys in "jwks_admin". The API knows an admin-deploy token by
//     the key that signed it (backend/app/core/security.py).
const isAdminSurface = appSurface === "admin";

// The mobile apps (Expo) sign in here too. Their requests carry the app scheme as
// their origin; custom schemes have no URL origin, so they're listed as-is.
const MOBILE_APP_SCHEMES = ["carabaomobile", "carabaomerchant"];
const mobileOrigins = [
  ...MOBILE_APP_SCHEMES.map((s) => `${s}://`),
  // Expo Go / dev builds on the LAN.
  ...(process.env.NODE_ENV !== "production" ? ["exp://", "exp://**"] : []),
];

const uniqueOrigins = (values: (string | undefined)[]) => [
  ...new Set(values.map(toOrigin).filter((origin): origin is string => Boolean(origin))),
];

// Admin deploy: its own origin only (no merchant host, no mobile app).
const trustedOrigins = isAdminSurface
  ? uniqueOrigins([appBaseUrl])
  : [
      ...uniqueOrigins([
        appBaseUrl,
        process.env.NEXT_PUBLIC_APP_URL,
        // merchant.<root>; on one host this is a path and adds nothing.
        merchantUrl("/"),
        process.env.RAILWAY_PUBLIC_DOMAIN,
        ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || "").split(","),
      ]),
      ...mobileOrigins,
    ];

// R1: one issuer for every API token. The admin deploy has another baseURL,
// so it must set AUTH_JWT_ISSUER to the public origin.
const jwtIssuer = toOrigin(process.env.AUTH_JWT_ISSUER) || appBaseUrl;
if (isAdminSurface && process.env.NODE_ENV === "production") {
  if (!process.env.AUTH_JWT_ISSUER) throw new Error("APP_SURFACE=admin needs AUTH_JWT_ISSUER (the public web origin).");
  if (!process.env.BETTER_AUTH_SECRET) throw new Error("APP_SURFACE=admin needs its own BETTER_AUTH_SECRET.");
}

// Shared cookies only when the app is really on the root domain: a browser
// drops a cookie for "carabao.online" set from localhost.
const crossSubDomainCookies =
  !isAdminSurface && subdomainMode ? { enabled: true, domain: rootDomain } : { enabled: false };


// Access tokens for the FastAPI backend (jwt plugin). FastAPI verifies them with
// the public keys at /api/auth/jwks and checks this issuer and audience; keep
// BETTER_AUTH_JWT_AUDIENCE in step on the backend if this ever changes.
const JWT_AUDIENCE = "carabao-api";

// How long a replaced phone number still gets payout alerts. Keep equal to
// OLD_NUMBER_ALERT_WINDOW in backend/app/services/phone_verification.py.
const OLD_NUMBER_ALERT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// How long a text code lasts. Same as the backend's own codes (backend/app/services/otp.py).
const PHONE_OTP_EXPIRES_IN_SECONDS = 600;

// Closes the admin plugin's HTTP endpoints (see lib/blocked-auth-paths.ts). Ban
// enforcement at sign-in runs in the plugin's session hook, so it keeps working;
// server-side auth.api.* calls don't go through onRequest and are unaffected.
const blockAdminEndpoints = (): BetterAuthPlugin => ({
  id: "carabao-block-admin-endpoints",
  onRequest: async (request) => {
    if (isBlockedAuthPath(new URL(request.url).pathname)) {
      return { response: new Response("Not Found", { status: 404 }) };
    }
  },
});

// Admin deploy: closes every Better Auth endpoint its pages do not use, and
// gives a session only to admins.
const adminSurfaceOnly = (): BetterAuthPlugin => ({
  id: "carabao-admin-surface-only",
  onRequest: async (request) => {
    if (isBlockedOnAdminSurface(new URL(request.url).pathname)) {
      return { response: new Response("Not Found", { status: 404 }) };
    }
  },
  hooks: {
    after: [
      {
        matcher: () => true,
        handler: createAuthMiddleware(async (ctx) => {
          const created = ctx.context.newSession as { session: SessionRow; user: SessionUser } | null;
          if (!created || isAdmin(created.user)) return;
          deleteSessionCookie(ctx, true);
          await ctx.context.internalAdapter.deleteSession(created.session.token).catch(() => {});
          throw new APIError("FORBIDDEN", {
            code: "NOT_AN_ADMIN",
            message: "This account is not an admin account.",
          });
        }),
      },
    ],
  },
});

// Public deploy: an admin account gets no session. The admin works on the admin
// site only, and uses a separate account to buy or sell. Before this rule, an
// admin who had not yet set up 2FA could still sign in here.
//
// The main refusal is in databaseHooks (session.create.before and
// account.create.before, in createAuth): no session or account row is ever
// written for an admin here. That matters once the public deploy has its own
// database login (documentation/manuals/DB_ROLE_SPLIT_PLAN.md, guard G2):
// the database then refuses those writes, and refusing first turns a database
// error page into this message. The after-hook below stays as a second check.
// Comes before adminTwoFactor(): a Google or Facebook sign-in is refused here,
// before that plugin sends it to the code page.
const ADMIN_ACCOUNT_MESSAGE =
  "This is a Carabao admin account. Sign in on the admin site, and use a separate account to buy or sell.";

// Thrown from a database hook. An OAuth callback (GET) catches an APIError with
// a body.code and redirects to the sign-in's errorCallbackURL with
// ?error=admin_account (better-auth 1.7.26 api/routes/callback.mjs), which
// lib/auth-client.ts socialErrorMessage shows. Other endpoints answer JSON.
const refuseAdminOnPublicSurface = (ctx: GenericEndpointContext | null): never => {
  if (ctx?.request?.method === "GET") {
    throw new APIError("FORBIDDEN", { code: "admin_account", message: ADMIN_ACCOUNT_MESSAGE });
  }
  throw new APIError("FORBIDDEN", { code: "ADMIN_ACCOUNT", message: ADMIN_ACCOUNT_MESSAGE });
};

// The answers BetterAuth gives a reset request for an address or number that
// may or may not have an account (better-auth 1.7.26 api/routes/password.mjs,
// plugins/phone-number/routes.mjs).
const EMAIL_RESET_RESPONSE = {
  status: true,
  message: "If this email exists in our system, check your email for the reset link",
};
const PHONE_RESET_RESPONSE = { status: true };

const noAdminsOnPublicSurface = (): BetterAuthPlugin => ({
  id: "carabao-no-admins-on-public-surface",
  hooks: {
    before: [
      // An admin resets their password on the admin site only. Here a reset
      // request for an admin answers exactly like one for an unknown address
      // and writes no token, so the response doesn't reveal that the address
      // or number is an admin's. (Once guard G3 is in place, the database
      // would refuse the token anyway, but as an error page.)
      {
        matcher: (ctx) => ctx.path === "/request-password-reset",
        handler: createAuthMiddleware(async (ctx) => {
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          if (typeof email !== "string" || !email) return;
          const found = await ctx.context.internalAdapter.findUserByEmail(email);
          if (!isAdmin(found?.user as SessionUser | undefined)) return;
          return ctx.json(EMAIL_RESET_RESPONSE);
        }),
      },
      {
        // Runs after otpResendCooldown() (earlier in the plugin list), so a
        // second request inside the wait is refused the same way as for any number.
        matcher: (ctx) => ctx.path === "/phone-number/request-password-reset",
        handler: createAuthMiddleware(async (ctx) => {
          const phone = (ctx.body as { phoneNumber?: unknown } | undefined)?.phoneNumber;
          if (typeof phone !== "string" || !phone) return;
          const user = await ctx.context.adapter.findOne<SessionUser>({
            model: "user",
            where: [{ field: "phoneNumber", value: phone }],
          });
          if (!isAdmin(user ?? undefined)) return;
          // BetterAuth writes a row even for a number with no account; this one
          // holds no code, and starts the same resend wait.
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: adminResetWaitIdentifier(phone),
            value: "0",
            expiresAt: new Date(Date.now() + PHONE_OTP_EXPIRES_IN_SECONDS * 1000),
          });
          return ctx.json(PHONE_RESET_RESPONSE);
        }),
      },
    ],
    after: [
      {
        // Every endpoint that makes a session (password, phone, social, signup,
        // two-factor verify).
        matcher: () => true,
        handler: createAuthMiddleware(async (ctx) => {
          const created = ctx.context.newSession as { session: SessionRow; user: SessionUser } | null;
          if (!created || !isAdmin(created.user)) return;
          deleteSessionCookie(ctx, true);
          await ctx.context.internalAdapter.deleteSession(created.session.token).catch(() => {});
          // An OAuth callback is a browser redirect: show the message on the sign-in page.
          if (ctx.request?.method === "GET") throw ctx.redirect(`${appBaseUrl}/auth?error=admin_account`);
          throw new APIError("FORBIDDEN", { code: "ADMIN_ACCOUNT", message: ADMIN_ACCOUNT_MESSAGE });
        }),
      },
    ],
  },
});

// ── Admin two-step verification (CF-0003, CF-0017, CF-0018) ───────────────
//
// Only admins use 2FA, and the admin area and API require it.
//   - Setup (/two-factor/enable) needs the one-time token from the link that
//     the backend sends with an admin invite (also the new invite after an
//     account reset or reactivation). Nobody is promoted to admin.
//     A password or a session alone is not enough, so a person who has only
//     those cannot enrol their own authenticator. allowPasswordless lets an
//     admin with no password (Google only) enrol. An account that has a
//     password must still type it: BetterAuth's shouldRequirePassword asks for
//     it whenever a "credential" account has one. That is on purpose: a
//     stolen session plus a leaked link is not enough.
//   - Admins cannot turn 2FA off. Another admin resets it (backend).
//   - Every way to sign in asks for the code, not only password sign-in: a
//     Google or Facebook sign-in for a 2FA account goes to /two-factor first.
//   - A session that passed the code step has mfaVerified = true. It goes to
//     the backend as the "mfa" claim, and the admin API requires it.
//   - Admins sign in on the website only, not in the mobile app.

// The API writes the audit row (ADMIN_TWO_FACTOR_ENROLLED) only if the
// database already shows 2FA on for that admin, so this call cannot fake a
// completion. A failure is logged and setup still succeeds
// (DB_ROLE_SPLIT_PLAN.md section 2).
async function reportTwoFactorEnrolled(userId: string) {
  const sharedSecret = process.env.AUTH_SYNC_SHARED_SECRET;
  if (!apiBaseUrl || !sharedSecret) {
    console.info("[admin-2fa] API not configured; setup not reported for the audit log.");
    return;
  }
  const res = await fetch(`${apiBaseUrl}/admin/two-factor/enrolled`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Auth-Sync-Secret": sharedSecret },
    body: JSON.stringify({ user_id: userId }),
  }).catch((err) => {
    console.error("[admin-2fa] Could not report the finished setup", err);
    return null;
  });
  if (res && !res.ok) console.error(`[admin-2fa] The API answered ${res.status} to the finished setup`);
}

const TWO_FACTOR_COOKIE = "two_factor"; // the twoFactor plugin's cookie name
const TWO_FACTOR_COOKIE_MAX_AGE = 600; // the plugin's default (10 minutes)

type SessionUser = { id: string; role?: string | null; twoFactorEnabled?: boolean | null };
type SessionRow = { token: string; mfaVerified?: boolean | null };

const isAdmin = (user: SessionUser | undefined) => user?.role === "admin";

const adminTwoFactor = (): BetterAuthPlugin => ({
  id: "carabao-admin-two-factor",
  schema: {
    session: {
      fields: {
        mfaVerified: { type: "boolean", required: false, input: false },
      },
    },
  },
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/two-factor/enable",
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          const user = session?.user as SessionUser | undefined;
          if (!user || !isAdmin(user)) {
            throw new APIError("FORBIDDEN", { message: "Two-step verification is only available for admin accounts." });
          }
          const token = ctx.headers?.get(ENROLMENT_TOKEN_HEADER);
          const stored = await ctx.context.internalAdapter.findVerificationValue(enrolmentIdentifier(user.id));
          if (!enrolmentTokenMatches(token, stored)) {
            throw new APIError("FORBIDDEN", {
              code: "ENROLMENT_LINK_INVALID",
              message: "This setup link is not valid or has expired. Ask another admin to send a new one.",
            });
          }
        }),
      },
      {
        matcher: (ctx) => ctx.path === "/two-factor/disable",
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (isAdmin(session?.user as SessionUser | undefined)) {
            throw new APIError("FORBIDDEN", {
              message: "Admins cannot turn off two-step verification. Ask another admin to reset it.",
            });
          }
        }),
      },
      {
        matcher: (ctx) => TOTP_SECRET_PATHS.includes(ctx.path ?? ""),
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if ((session?.session as SessionRow | undefined)?.mfaVerified !== true) {
            throw new APIError("FORBIDDEN", { message: "Sign in again with your authenticator code first." });
          }
        }),
      },
    ],
    after: [
      {
        // Every endpoint that makes a session. Must come after twoFactor() in
        // the plugin list: a later after-hook can replace the response.
        matcher: () => true,
        handler: createAuthMiddleware(async (ctx) => {
          const created = ctx.context.newSession as { session: SessionRow; user: SessionUser } | null;
          if (!created) return;
          // The same session written again (refresh, profile update): not a sign-in.
          const current = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
          if (current && current === created.session.token) return;

          const dropSession = async () => {
            deleteSessionCookie(ctx, true);
            await ctx.context.internalAdapter.deleteSession(created.session.token).catch(() => {});
          };

          if (isAdmin(created.user) && isMobileRequest(ctx.headers ?? ctx.request?.headers)) {
            await dropSession();
            throw new APIError("FORBIDDEN", {
              code: "ADMIN_WEB_ONLY",
              message: "Admin accounts sign in on the Carabao website, not in the app.",
            });
          }

          if (ctx.path.startsWith("/two-factor/")) {
            // Setup finished: the link is used up.
            if (ctx.path === "/two-factor/verify-totp" && created.user.twoFactorEnabled) {
              await ctx.context.internalAdapter.deleteVerificationByIdentifier(enrolmentIdentifier(created.user.id));
              await reportTwoFactorEnrolled(created.user.id);
            }
            return;
          }

          // CF-0017: a sign-in that skipped the code step (Google, Facebook,
          // email link). Do what the twoFactor plugin does for a password
          // sign-in: no session, a short-lived two_factor cookie, then the code page.
          if (!created.user.twoFactorEnabled || created.session.mfaVerified === true) return;
          await dropSession();
          const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE, { maxAge: TWO_FACTOR_COOKIE_MAX_AGE });
          const identifier = `2fa-${generateRandomString(20)}`;
          await ctx.context.internalAdapter.createVerificationValue({
            value: created.user.id,
            identifier,
            expiresAt: new Date(Date.now() + TWO_FACTOR_COOKIE_MAX_AGE * 1000),
          });
          await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
          // An OAuth callback is a browser redirect; other endpoints answer JSON,
          // which the client's onTwoFactorRedirect handles.
          if (ctx.request?.method === "GET") throw ctx.redirect(`${appBaseUrl}/two-factor`);
          return ctx.json({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
        }),
      },
    ],
  },
});

// ── Phone numbers (BetterAuth phoneNumber plugin) ─────────────────────────
//
// Signup (web and mobile) is by code: verifying a code for a new number
// creates the account with the number verified (signUpOnVerification), then
// the client sets a password (/phone-number/set-password below). There is no
// codeless phone signup. Sign-in is phone + password. BetterAuth makes, stores and checks the
// codes; the backend delivers them so the Semaphore key and the per-number limit
// live in one place (POST /internal/sms/account-otp).

type OtpPurpose = "verify" | "password_reset";

async function sendAccountOtp(
  phoneNumber: string,
  code: string,
  purpose: OtpPurpose,
  ctx: GenericEndpointContext | undefined,
) {
  const sharedSecret = process.env.AUTH_SYNC_SHARED_SECRET;
  if (!apiBaseUrl || !sharedSecret) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[sms] SMS not configured. ${purpose} code for ${phoneNumber}: ${code}`);
      return;
    }
    throw new APIError("INTERNAL_SERVER_ERROR", { message: "Text messages aren't set up yet." });
  }
  const res = await fetch(`${apiBaseUrl}/internal/sms/account-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Auth-Sync-Secret": sharedSecret },
    body: JSON.stringify({ phone_number: phoneNumber, code, purpose }),
  }).catch((err) => {
    console.error("[sms] Failed to reach the backend", err);
    return null;
  });
  if (!res) {
    throw new APIError("BAD_GATEWAY", { message: "We couldn't send the code. Try again shortly." });
  }
  const body = (await res.json().catch(() => null)) as { code?: string; detail?: string } | null;
  if (!res.ok) {
    // 429 carries "Too many codes requested. Please try again in N minutes."
    throw new APIError(res.status === 429 ? "TOO_MANY_REQUESTS" : "BAD_GATEWAY", {
      message: body?.detail || "We couldn't send the code. Try again shortly.",
    });
  }
  // Semaphore may deliver its own code instead of ours; keep the one the user got.
  if (body?.code && body.code !== code && ctx) {
    const identifier = purpose === "password_reset" ? phoneResetIdentifier(phoneNumber) : phoneOtpIdentifier(phoneNumber);
    await ctx.context.internalAdapter.updateVerificationByIdentifier(identifier, { value: `${body.code}:0` });
  }
}

// /phone-number/verify does more than BetterAuth's name suggests: without
// updatePhoneNumber it signs in to whatever account holds the number (an SMS
// code as a password-less login that also skips admin TOTP), and with
// disableSession it marks any account's number verified, or creates an account
// nobody is signed in to. Only three uses are allowed:
//   - signup: the number has no account yet (signUpOnVerification creates it);
//   - verifying your own number: disableSession, signed in, number is yours;
//   - adding or changing your number: updatePhoneNumber, signed in
//     (BetterAuth then refuses a number already on any account).
const phoneVerifyGuard = (): BetterAuthPlugin => ({
  id: "carabao-phone-verify-guard",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/phone-number/verify",
        handler: createAuthMiddleware(async (ctx) => {
          const body = (ctx.body ?? {}) as { phoneNumber?: string; disableSession?: boolean; updatePhoneNumber?: boolean };
          if (body.updatePhoneNumber) return;
          if (body.disableSession) {
            const session = await getSessionFromCtx(ctx);
            const own = (session?.user as { phoneNumber?: string | null } | undefined)?.phoneNumber;
            if (!session || !body.phoneNumber || own !== body.phoneNumber) {
              throw new APIError("FORBIDDEN", { message: "You can only verify the number on your own account." });
            }
            return;
          }
          const existing = body.phoneNumber
            ? await ctx.context.adapter.findOne({ model: "user", where: [{ field: "phoneNumber", value: body.phoneNumber }] })
            : null;
          if (existing) {
            throw new APIError("BAD_REQUEST", {
              code: "PHONE_NUMBER_EXIST",
              message: "That number already has an account. Log in instead.",
            });
          }
        }),
      },
    ],
  },
});

// Cloudflare Turnstile on the public endpoints that send a text code or a
// reset email (lib/captcha.ts). On only when TURNSTILE_SECRET_KEY is set. The
// mobile app has no widget yet, so its requests skip the check and rely on the
// rate limits; the mobile check is a header, so this stops casual scripts on
// the web endpoints, not a determined one.
const turnstileSecret = (process.env.TURNSTILE_SECRET_KEY || "").trim();

const captchaResponse = (status: number, code: string, message: string) => ({
  response: Response.json({ code, message }, { status }),
});

const otpCaptcha = (): BetterAuthPlugin => ({
  id: "carabao-otp-captcha",
  onRequest: async (request) => {
    if (!turnstileSecret || !needsCaptcha(new URL(request.url).pathname, AUTH_BASE_PATH)) return;
    if (isMobileRequest(request.headers)) return;
    const token = request.headers.get(CAPTCHA_HEADER);
    if (!token) return captchaResponse(400, "CAPTCHA_MISSING", CAPTCHA_FAILED_MESSAGE);
    const result = await verifyTurnstile({ token, secret: turnstileSecret });
    if (result === "failed") return captchaResponse(403, "CAPTCHA_FAILED", CAPTCHA_FAILED_MESSAGE);
    if (result === "unavailable") {
      console.error("[captcha] Cloudflare Turnstile could not be reached");
      return captchaResponse(503, "CAPTCHA_UNAVAILABLE", "We couldn't send the code. Try again shortly.");
    }
  },
});

// Site-wide OTP resend wait (lib/otp-cooldown.ts): one code a minute per
// number. Checked before BetterAuth writes the new code, so a refused resend
// leaves the code already sent working. A password-reset request for a number
// with no account also writes a row, so the wait doesn't reveal which exist.
const otpResendCooldown = (): BetterAuthPlugin => ({
  id: "carabao-otp-resend-cooldown",
  hooks: {
    before: [
      {
        matcher: (ctx) => Boolean(ctx.path && OTP_SEND_PATHS[ctx.path]),
        handler: createAuthMiddleware(async (ctx) => {
          const phone = (ctx.body as { phoneNumber?: unknown } | undefined)?.phoneNumber;
          if (typeof phone !== "string" || !phone) return;
          const [latest] = await ctx.context.adapter.findMany<{ createdAt: Date }>({
            model: "verification",
            where: [{ field: "identifier", operator: "in", value: OTP_SEND_PATHS[ctx.path!](phone) }],
            sortBy: { field: "createdAt", direction: "desc" },
            limit: 1,
          });
          const wait = resendWaitSeconds(latest?.createdAt);
          if (wait > 0) {
            throw new APIError(
              "TOO_MANY_REQUESTS",
              {
                code: "OTP_RESEND_COOLDOWN",
                message: `Please wait ${wait} seconds before requesting another code.`,
                retryAfter: wait,
              },
              { "Retry-After": String(wait) },
            );
          }
        }),
      },
    ],
  },
});

// CF-0019: when /phone-number/verify (updatePhoneNumber) replaces a number,
// keep the old one and the time. For 3 days the backend also sends payout-change
// alerts to the old number (backend/app/services/payout_otp.py alert_numbers),
// because a hijacked session can verify a number of its own.
const phoneChangeHistory = (): BetterAuthPlugin => ({
  id: "carabao-phone-change-history",
  schema: {
    user: {
      fields: {
        previousPhoneNumber: { type: "string", required: false, input: false },
        phoneNumberChangedAt: { type: "date", required: false, input: false },
      },
    },
  },
  init: () => ({
    options: {
      databaseHooks: {
        user: {
          update: {
            before: async (data, ctx) => {
              const next = (data as { phoneNumber?: string | null }).phoneNumber;
              if (!ctx || next === undefined) return;
              // The phone route has already read the session (getSessionFromCtx caches it).
              const session = await getSessionFromCtx(ctx);
              if (!session) return;
              const current = (await ctx.context.internalAdapter.findUserById(session.user.id)) as
                | {
                    phoneNumber?: string | null;
                    previousPhoneNumber?: string | null;
                    phoneNumberChangedAt?: Date | string | null;
                  }
                | null;
              const old = current?.phoneNumber;
              if (!old || old === next) return;
              // CF-0032: a second change inside the alert window keeps the number
              // from before the first one, so a hijacked session cannot push the
              // owner's number out by verifying two numbers in a row.
              const lastChange = current?.phoneNumberChangedAt
                ? new Date(current.phoneNumberChangedAt).getTime()
                : 0;
              const inWindow = Date.now() - lastChange <= OLD_NUMBER_ALERT_WINDOW_MS;
              const previous = inWindow ? (current?.previousPhoneNumber ?? old) : old;
              return {
                data: { ...data, previousPhoneNumber: previous, phoneNumberChangedAt: new Date() },
              };
            },
          },
        },
      },
    },
  }),
});

// After a phone signup's code is verified the account has no password yet;
// BetterAuth only exposes setPassword to the server, so this adds the step.
// Also used by the profile page's Account section to add a password to an
// account that signs in with Google/Facebook only: that needs a sign-in in the
// last 15 minutes, so a stolen session cannot add a password of its own
// (sensitiveSessionMiddleware checks only that the session is valid). An
// account that already has a password is refused (changing one goes through
// change-password).
const ADD_PASSWORD_SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

const phoneSignupPassword = (): BetterAuthPlugin => ({
  id: "carabao-phone-signup-password",
  endpoints: {
    setPhoneSignupPassword: createAuthEndpoint(
      "/phone-number/set-password",
      {
        method: "POST",
        body: z.object({ newPassword: z.string() }),
        use: [sensitiveSessionMiddleware],
      },
      async (ctx) => {
        // passwordPolicy() has already checked newPassword.
        const { newPassword } = ctx.body;
        const userId = ctx.context.session.user.id;
        const accounts = await ctx.context.internalAdapter.findAccounts(userId);
        if (accounts.some((account) => account.providerId === "credential")) {
          throw new APIError("BAD_REQUEST", { message: "This account already has a password." });
        }
        // A phone signup has no account rows yet and its session is brand new.
        const signedInAt = new Date(ctx.context.session.session.createdAt).getTime();
        if (accounts.length > 0 && Date.now() - signedInAt >= ADD_PASSWORD_SIGN_IN_WINDOW_MS) {
          throw new APIError("FORBIDDEN", {
            code: "SESSION_NOT_FRESH",
            message: "For your security, log out and log in again, then add the password.",
          });
        }
        await ctx.context.internalAdapter.linkAccount({
          userId,
          providerId: "credential",
          accountId: userId,
          password: await ctx.context.password.hash(newPassword),
        });
        return ctx.json({ status: true });
      },
    ),
  },
});

// Every endpoint that sets a new password obeys lib/password-policy.ts.
// Sign-in is not checked: it only compares with the stored password.
const NEW_PASSWORD_PATHS = [
  "/phone-number/set-password",
  "/phone-number/reset-password",
  "/reset-password",
  "/change-password",
  "/set-password",
];

const passwordPolicy = (): BetterAuthPlugin => ({
  id: "carabao-password-policy",
  hooks: {
    before: [
      {
        matcher: (ctx) => NEW_PASSWORD_PATHS.includes(ctx.path ?? ""),
        handler: createAuthMiddleware(async (ctx) => {
          const newPassword = (ctx.body as { newPassword?: unknown } | undefined)?.newPassword;
          // The admin deploy has admins only, so it uses the admin rule (12+).
          const ok = isAdminSurface ? isStrongAdminPassword : isStrongPassword;
          if (typeof newPassword !== "string" || !ok(newPassword)) {
            const message = isAdminSurface ? ADMIN_PASSWORD_RULE_MESSAGE : PASSWORD_RULE_MESSAGE;
            throw new APIError("BAD_REQUEST", { code: "WEAK_PASSWORD", message });
          }
        }),
      },
    ],
  },
});

// Admin deploy: the profile page (app/(site)/(admin)/admin/profile).
//   - /change-password and /update-user need a session that passed the code
//     step, as the admin pages and the admin API do. A session of an admin who
//     has not set up TOTP yet cannot change the password.
//   - /update-user changes the display name only. Role, ban and 2FA fields are
//     input: false in BetterAuth, and guard G1 refuses them in the database;
//     this also keeps "image" and any later field out.
//   - /change-password keeps 2FA as it is. The client asks to sign out the
//     other sessions; the new session keeps mfaVerified (session.create.before).
const ADMIN_NAME_MAX_LENGTH = 100;

const adminProfileGuard = (): BetterAuthPlugin => ({
  id: "carabao-admin-profile-guard",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/change-password" || ctx.path === "/update-user",
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if ((session?.session as SessionRow | undefined)?.mfaVerified !== true) {
            throw new APIError("FORBIDDEN", { message: "Sign in again with your authenticator code first." });
          }
          if (ctx.path !== "/update-user") return;
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const name = typeof body.name === "string" ? body.name.trim() : "";
          if (Object.keys(body).some((key) => key !== "name") || !name || name.length > ADMIN_NAME_MAX_LENGTH) {
            throw new APIError("BAD_REQUEST", {
              message: `Only the display name can be changed here (1 to ${ADMIN_NAME_MAX_LENGTH} characters).`,
            });
          }
        }),
      },
    ],
  },
});

const sendEmailThroughBackend = async (path: string, payload: Record<string, string>, what: string) => {
  const sharedSecret = process.env.AUTH_SYNC_SHARED_SECRET;
  if (!apiBaseUrl || !sharedSecret) {
    console.info(`[${what}] Email not configured.`, payload);
    return;
  }
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Auth-Sync-Secret": sharedSecret },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.error(`[${what}] Failed to reach backend email service`, err);
    return null;
  });
  if (!res?.ok) console.error(`[${what}] Backend returned ${res?.status}`);
};

function createAuth() {
  if (!turnstileSecret && process.env.NODE_ENV === "production") {
    console.warn("[captcha] TURNSTILE_SECRET_KEY is not set: code requests have no CAPTCHA.");
  }
  return betterAuth({
    // E8: TOTP two-step verification ("Carabao" is the name shown in authenticator apps).
    // Always loaded, because admins always need it (CF-0003); who may turn it on,
    // and the other admin rules, are in adminTwoFactor above.
    plugins: [
      blockAdminEndpoints(),
      otpCaptcha(),
      admin(),
      // No password for setup: the one-time link replaces it (CF-0018).
      twoFactor({ issuer: "Carabao", allowPasswordless: true }),
      phoneNumber({
        // One stored form, so a number can't sign up twice written differently.
        // Clients normalize first (lib/phone.ts normalizePhMobile).
        phoneNumberValidator: (value) => PH_MOBILE_PATTERN.test(value),
        otpLength: 6,
        expiresIn: PHONE_OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: 5,
        sendOTP: ({ phoneNumber, code }, ctx) => sendAccountOtp(phoneNumber, code, "verify", ctx),
        sendPasswordResetOTP: ({ phoneNumber, code }, ctx) =>
          sendAccountOtp(phoneNumber, code, "password_reset", ctx),
        signUpOnVerification: {
          getTempEmail: (phone) => `${phone.replace(/\D/g, "")}@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`,
          // The signup form sends the real name right after (updateUser).
          getTempName: () => "",
        },
      }),
      phoneVerifyGuard(),
      otpResendCooldown(),
      phoneChangeHistory(),
      phoneSignupPassword(),
      passwordPolicy(),
      // Public deploy: no session for an admin account (before adminTwoFactor()).
      ...(isAdminSurface ? [] : [noAdminsOnPublicSurface()]),
      // After twoFactor(), so that its after-hook has the last word on the response.
      adminTwoFactor(),
      // Last: it has the final word on whether a session stays.
      ...(isAdminSurface ? [adminProfileGuard(), adminSurfaceOnly()] : [expo()]),
      jwt({
        // Admin deploy: own key table, so the API can tell its tokens apart.
        // The private keys stay encrypted with this deploy's BETTER_AUTH_SECRET.
        ...(isAdminSurface ? { schema: { jwks: { modelName: "jwks_admin" } } } : {}),
        jwt: {
          issuer: jwtIssuer,
          audience: JWT_AUDIENCE,
          // Admin tokens live 5 minutes: after sign-out, a copied admin token
          // works for at most that long. The client refetches from "exp"
          // (lib/auth-client.ts), so a shorter life needs no other change.
          expirationTime: isAdminSurface ? "5m" : "15m",
          // The backend reads name, email, phone, role, ban and 2FA live from the
          // "user" table (backend/app/models/auth_identity.py). The token adds only
          // whether this session passed the code step (CF-0017), and the deploy
          // (the API checks it against the key that signed the token).
          definePayload: ({ session }) => ({
            mfa: (session as unknown as SessionRow).mfaVerified === true,
            surface: appSurface,
          }),
        },
      }),
    ],
    user: {
      // Adding an email (profile page) only takes effect once the link sent to it
      // is opened, so every real address on an account is verified. That matters:
      // a Google sign-in links to the account holding the same email.
      changeEmail: { enabled: true },
    },
    // Each deploy has its own database login (carabao_web_public or
    // carabao_web_admin), and the database's guards (backend/db/guards.sql,
    // G3) match "verification" identifiers by their prefix. Do NOT set
    // verification.storeIdentifier or secondaryStorage: identifiers would become
    // hashes or leave the table, and G3 would silently match nothing. If either
    // ever changes, run backend/tests_pg (it asserts an admin's reset token
    // insert fails).
    database: createPool(),
    databaseHooks: {
      session: {
        create: {
          // CF-0017: mark the sessions that passed the code step. Set when the
          // session is made, so that the session cookie cache has it too.
          before: async (session, ctx) => {
            if (!ctx) return;
            const user = (await ctx.context.internalAdapter.findUserById(session.userId)) as SessionUser | null;
            // Public deploy: no session for an admin (see noAdminsOnPublicSurface).
            if (!isAdminSurface && isAdmin(user ?? undefined)) refuseAdminOnPublicSurface(ctx);
            // The caller's own session, when this one replaces it (e.g. change
            // password with "sign out other devices").
            const caller = ctx.context.session as { session: SessionRow; user: SessionUser } | null | undefined;
            const passed =
              // A session that the twoFactor plugin makes again copies the old one.
              (session as { mfaVerified?: boolean | null }).mfaVerified === true ||
              (caller?.user.id === session.userId && caller.session.mfaVerified === true) ||
              sessionPassedTotp(ctx.path, Boolean(user?.twoFactorEnabled));
            return { data: { ...session, mfaVerified: passed } };
          },
        },
      },
      account: {
        create: {
          // Public deploy: no new sign-in method for an admin, e.g. a Google
          // account linked by email during an OAuth sign-in (see noAdminsOnPublicSurface).
          before: async (account, ctx) => {
            if (isAdminSurface || !ctx) return;
            const user = (await ctx.context.internalAdapter.findUserById(account.userId)) as SessionUser | null;
            if (isAdmin(user ?? undefined)) refuseAdminOnPublicSurface(ctx);
          },
        },
      },
    },
    // E7: BetterAuth limits by client IP; rules and storage in
    // lib/auth-rate-limit.ts (CF-0080).
    rateLimit: authRateLimit(process.env),
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    advanced: {
      cookiePrefix: isAdminSurface ? "carabao-admin" : "carabao",
      crossSubDomainCookies,
    },
    baseURL: appBaseUrl,
    trustedOrigins,
    basePath: AUTH_BASE_PATH,
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Accounts are created by phone, Google or Facebook only; email + password still
      // signs in an account that has a verified email.
      disableSignUp: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      // Reset by email is for accounts with a verified email; everyone else
      // resets by SMS (/phone-number/request-password-reset).
      sendResetPassword: async ({ user, url }) => {
        if (!user.emailVerified || isPlaceholderEmail(user.email)) return;
        await sendEmailThroughBackend("/email/send-password-reset", { to: user.email, reset_url: url }, "password-reset");
      },
    },
    emailVerification: {
      // Only for an email added on the profile page (changeEmail).
      sendOnSignUp: false,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        if (isPlaceholderEmail(user.email)) return;
        await sendEmailThroughBackend("/email/send-verification", { to: user.email, verification_url: url }, "email-verify");
      },
    },
    // Google and Facebook accounts can be created without a phone; checkout,
    // merchant applications and order chat ask them to add one (backend
    // require_verified_phone). Keys live in the frontend env (.env.local).
    // Not on the admin deploy: admins sign in with email + password, then TOTP.
    socialProviders: isAdminSurface ? {} : {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || "your-google-client-id",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || "your-google-client-secret",
      },
      facebook: {
        clientId: process.env.FACEBOOK_CLIENT_ID || "your-facebook-client-id",
        clientSecret: process.env.FACEBOOK_CLIENT_SECRET || "your-facebook-client-secret",
        // Facebook accounts registered by phone have no email; BetterAuth needs
        // one, so they get an undeliverable placeholder (hidden like phone signups').
        // BetterAuth 1.7: a Limited Login profile has `sub`, a Graph one `id`.
        mapProfileToUser: (profile) =>
          profile.email
            ? {}
            : {
                email: `facebook-${"id" in profile ? profile.id : profile.sub}@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`,
              },
      },
    },
  });
}

// Made on first use, not at import. `next build` loads every route module to
// read its config, and the help deploy (APP_SURFACE=help) builds with no
// database URL and no secrets. It never calls this: proxy.ts sends only /help
// pages there and refuses /api.
type Auth = ReturnType<typeof createAuth>;
let instance: Auth | null = null;
const getAuth = (): Auth => (instance ??= createAuth());

export const auth = new Proxy({} as Auth, {
  get: (_target, property) => {
    const real = getAuth();
    const value = Reflect.get(real, property);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export type Session = Auth["$Infer"]["Session"];
