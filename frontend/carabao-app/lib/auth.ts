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
import type { GenericEndpointContext } from "@better-auth/core";
import { Pool } from "pg";
import * as z from "zod";
import { AUTH_BASE_PATH, isBlockedAuthPath } from "@/lib/blocked-auth-paths";
import { TWO_FACTOR_ENABLED } from "@/lib/features";
import { PH_MOBILE_PATTERN, PHONE_PLACEHOLDER_EMAIL_DOMAIN, isPlaceholderEmail } from "@/lib/phone";

const rawPostgresUrl =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRESQL_URL ||
  process.env.PGDATABASE_URL;

const normalizedPostgresUrl = rawPostgresUrl
  ? rawPostgresUrl.trim().replace(/^"|"$/g, "")
  : "";

if (!normalizedPostgresUrl) {
  throw new Error(
    "Better Auth Postgres URL is missing. Set one of: POSTGRES_URL, DATABASE_URL, POSTGRESQL_URL, or PGDATABASE_URL."
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

const pool = (() => {
  try {
    const u = new URL(normalizedPostgresUrl);
    return new Pool({
      host: u.hostname,
      port: Number(u.port) || 5432,
      database: u.pathname.replace(/^\//, ""),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      ssl: { rejectUnauthorized: false },
    });
  } catch {
    return new Pool({ 
      connectionString: 
      normalizedPostgresUrl, 
      ssl: { rejectUnauthorized: true}
    });
  }
})();

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_FASTAPI_URL || "";
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

// The mobile app (Expo) signs in here too. Its requests carry the app scheme as
// their origin; custom schemes have no URL origin, so they're listed as-is.
const MOBILE_APP_SCHEME = "carabaomobile";
const mobileOrigins = [
  `${MOBILE_APP_SCHEME}://`,
  // Expo Go / dev builds on the LAN.
  ...(process.env.NODE_ENV !== "production" ? ["exp://", "exp://**"] : []),
];

const trustedOrigins = [
  ...new Set(
    [
      appBaseUrl,
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.FRONTEND_URL,
      process.env.RAILWAY_PUBLIC_DOMAIN,
      ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || "").split(","),
    ]
      .map(toOrigin)
      .filter((origin): origin is string => Boolean(origin))
  ),
  ...mobileOrigins,
];

// Access tokens for the FastAPI backend (jwt plugin). FastAPI verifies them with
// the public keys at /api/auth/jwks and checks this issuer and audience; keep
// BETTER_AUTH_JWT_AUDIENCE in step on the backend if this ever changes.
const JWT_AUDIENCE = "carabao-api";

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

// Two-step verification is for admins only: nobody else can turn it on.
// Turning it off stays open to everyone (e.g. a demoted admin).
const adminOnlyTwoFactor = (): BetterAuthPlugin => ({
  id: "carabao-admin-only-two-factor",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/two-factor/enable",
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (session?.user.role !== "admin") {
            throw new APIError("FORBIDDEN", { message: "Two-step verification is only available for admin accounts." });
          }
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
    const identifier = purpose === "password_reset" ? `${phoneNumber}-request-password-reset` : phoneNumber;
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

// After a phone signup's code is verified the account has no password yet;
// BetterAuth only exposes setPassword to the server, so this adds the step.
// Only for an account with no sign-in method at all (a phone signup that just
// verified its code); a Google/Facebook account or one with a password is
// refused (changing one goes through change-password).
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
        const { newPassword } = ctx.body;
        const { minPasswordLength, maxPasswordLength } = ctx.context.password.config;
        if (newPassword.length < minPasswordLength || newPassword.length > maxPasswordLength) {
          throw new APIError("BAD_REQUEST", {
            message: `Use ${minPasswordLength} to ${maxPasswordLength} characters.`,
          });
        }
        const userId = ctx.context.session.user.id;
        const accounts = await ctx.context.internalAdapter.findAccounts(userId);
        if (accounts.length > 0) {
          throw new APIError("BAD_REQUEST", { message: "This account already has a way to sign in." });
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

export const auth = betterAuth({
  // E8: TOTP two-step verification ("Carabao" is the name shown in authenticator apps),
  // admins only (adminOnlyTwoFactor above).
  // Switched off for now (lib/features.ts): without the plugin, sign-in never asks
  // for a code, even for accounts that turned it on earlier.
  plugins: [
    blockAdminEndpoints(),
    admin(),
    ...(TWO_FACTOR_ENABLED ? [adminOnlyTwoFactor(), twoFactor({ issuer: "Carabao" })] : []),
    phoneNumber({
      // One stored form, so a number can't sign up twice written differently.
      // Clients normalize first (lib/phone.ts normalizePhMobile).
      phoneNumberValidator: (value) => PH_MOBILE_PATTERN.test(value),
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
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
    phoneSignupPassword(),
    expo(),
    jwt({
      jwt: {
        issuer: appBaseUrl,
        audience: JWT_AUDIENCE,
        expirationTime: "15m",
        // The backend needs only the subject: it reads name, email, phone, role,
        // ban and 2FA live from the "user" table (backend/app/models/auth_identity.py).
        definePayload: () => ({}),
      },
    }),
  ],
  user: {
    // Adding an email (profile page) only takes effect once the link sent to it
    // is opened, so every real address on an account is verified. That matters:
    // a Google sign-in links to the account holding the same email.
    changeEmail: { enabled: true },
  },
  database: pool,
  // E7: BetterAuth limits by client IP. Defaults to production only; stricter
  // rules for the credential and SMS endpoints. (The per-number SMS limit lives
  // in the FastAPI backend, app/services/rate_limit.py.)
  rateLimit: {
    enabled: process.env.NODE_ENV === "production" || process.env.BETTER_AUTH_RATE_LIMIT === "true",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 900, max: 10 },
      "/sign-in/phone-number": { window: 900, max: 10 },
      // Lenient on purpose (no CAPTCHA yet): 20 codes per IP per hour.
      "/phone-number/send-otp": { window: 3600, max: 20 },
      "/phone-number/request-password-reset": { window: 3600, max: 20 },
      "/phone-number/verify": { window: 900, max: 30 },
      "/phone-number/reset-password": { window: 900, max: 10 },
      "/request-password-reset": { window: 900, max: 5 },
      "/reset-password": { window: 900, max: 10 },
      "/change-email": { window: 3600, max: 5 },
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  baseURL: appBaseUrl,
  trustedOrigins,
  basePath: AUTH_BASE_PATH,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
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
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "your-google-client-id",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "your-google-client-secret",
    },
    facebook: {
      clientId: process.env.FACEBOOK_CLIENT_ID || "your-facebook-client-id",
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET || "your-facebook-client-secret",
      // Facebook accounts registered by phone have no email; BetterAuth needs
      // one, so they get an undeliverable placeholder (hidden like phone signups').
      mapProfileToUser: (profile) =>
        profile.email ? {} : { email: `facebook-${profile.id}@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}` },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
