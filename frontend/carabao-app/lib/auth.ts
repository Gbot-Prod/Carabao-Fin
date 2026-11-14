import { createHmac, timingSafeEqual } from "node:crypto";
import { expo } from "@better-auth/expo";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { admin, jwt, twoFactor } from "better-auth/plugins";
import { AUTH_BASE_PATH, isBlockedAuthPath } from "@/lib/blocked-auth-paths";
import { TWO_FACTOR_ENABLED } from "@/lib/features";
import { Pool } from "pg";

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

type SignupVerification ={ channel: "email" | "phone"; identifier: string };

// Reads the pre-account OTP token issued by FastAPI's /auth/signup-verification/verify.
// Mirrors read_token in backend/app/services/phone_verification.py. The web sends
// it as a cookie; the mobile app, which can't set cookies, as a header.
export const SIGNUP_VERIFICATION_HEADER = "x-signup-verification";
function readSignupVerification(token: string | null | undefined): SignupVerification | null {
  const secret = process.env.AUTH_SYNC_SHARED_SECRET;
  if (!token || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const signature = Buffer.from(token.slice(dot + 1), "hex");
  const expected = createHmac("sha256", secret).update(payload).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp < Date.now() / 1000) return null;
    if (data.channel !== "email" && data.channel !== "phone") return null;
    if (typeof data.identifier !== "string" || !data.identifier) return null;
    return { channel: data.channel, identifier: data.identifier };
  } catch {
    return null;
  }
}

export const auth = betterAuth({
  // E8: TOTP two-step verification ("Carabao" is the name shown in authenticator apps),
  // admins only (adminOnlyTwoFactor above).
  // Switched off for now (lib/features.ts): without the plugin, sign-in never asks
  // for a code, even for accounts that turned it on earlier.
  plugins: [
    blockAdminEndpoints(),
    admin(),
    ...(TWO_FACTOR_ENABLED ? [adminOnlyTwoFactor(), twoFactor({ issuer: "Carabao" })] : []),
    expo(),
    jwt({
      jwt: {
        issuer: appBaseUrl,
        audience: JWT_AUDIENCE,
        expirationTime: "15m",
        // Only what the backend needs; it looks everything else up itself.
        definePayload: ({ user }) => ({
          email: user.email,
          emailVerified: user.emailVerified,
          name: user.name,
          role: user.role ?? null,
          twoFactorEnabled: Boolean(user.twoFactorEnabled),
          phoneNumber: user.phoneNumber ?? null,
          // A Google sign-in's photo; the backend uses it as the first avatar.
          image: user.image ?? null,
        }),
      },
    }),
  ],
  user: {
    additionalFields: {
      // The number a phone signup verified (set by the create hook below).
      phoneNumber: { type: "string", required: false, input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Email/password signups must carry a verified OTP token. An email token
        // proves the address; a phone token does not, so those accounts stay
        // unverified and can't sign in until the emailed link is clicked.
        before: async (user, ctx) => {
          if (ctx?.path !== "/sign-up/email") return;
          const verification = readSignupVerification(
            ctx.getCookie("pending_signup_verification") ?? ctx.headers?.get(SIGNUP_VERIFICATION_HEADER)
          );
          if (!verification) {
            throw new APIError("FORBIDDEN", { message: "Verify your email or phone number before signing up." });
          }
          if (verification.channel === "email") {
            if (verification.identifier.trim().toLowerCase() !== user.email.toLowerCase()) {
              throw new APIError("FORBIDDEN", { message: "Verified email does not match signup email." });
            }
            return { data: { ...user, emailVerified: true } };
          }
          return { data: { ...user, emailVerified: false, phoneNumber: verification.identifier } };
        },
      },
    },
  },
  database: pool,
  // E7: BetterAuth limits by client IP. Defaults to production only; stricter
  // rules for the credential endpoints. (Per-email limits for the app and the
  // OTP steps live in the FastAPI backend, app/services/rate_limit.py.)
  rateLimit: {
    enabled: process.env.NODE_ENV === "production" || process.env.BETTER_AUTH_RATE_LIMIT === "true",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 900, max: 10 },
      "/sign-up/email": { window: 3600, max: 10 },
      "/request-password-reset": { window: 900, max: 5 },
      "/reset-password": { window: 900, max: 10 },
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
    // Email-OTP signups are marked verified by the create hook above; phone
    // signups must click the emailed link before they can sign in.
    requireEmailVerification: true,
    // Whoever proves the inbox via a reset kicks out anyone who registered
    // the address first.
    revokeSessionsOnPasswordReset: true,
    // Following the emailed link proves the inbox, so the reset also verifies the
    // email. Accounts moved over from the old app login (no password yet) get in
    // with a single reset.
    onPasswordReset: async ({ user }) => {
      if (user.emailVerified) return;
      await pool.query('UPDATE "user" SET "emailVerified" = true, "updatedAt" = now() WHERE id = $1', [user.id]);
    },
    // Forgot-password (E6): the link goes out through the backend's email service.
    sendResetPassword: async ({ user, url }) => {
      const sharedSecret = process.env.AUTH_SYNC_SHARED_SECRET;
      if (!apiBaseUrl || !sharedSecret) {
        console.info(`[password-reset] Email not configured. Reset link for ${user.email}: ${url}`);
        return;
      }
      const res = await fetch(`${apiBaseUrl}/email/send-password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Auth-Sync-Secret": sharedSecret },
        body: JSON.stringify({ to: user.email, reset_url: url }),
      }).catch((err) => {
        console.error("[password-reset] Failed to reach backend email service", err);
        return null;
      });
      if (!res?.ok) console.error(`[password-reset] Backend returned ${res?.status} for ${user.email}`);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (user.emailVerified) return;
      if (!apiBaseUrl) {
        console.info(`[email-verify] No API URL configured. Verification link for ${user.email}: ${url}`);
        return;
      }

      const sharedSecret = process.env.AUTH_SYNC_SHARED_SECRET;
      if (!sharedSecret) {
        console.error("[email-verify] AUTH_SYNC_SHARED_SECRET is not set");
        return;
      }

      const res = await fetch(`${apiBaseUrl}/email/send-verification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Auth-Sync-Secret": sharedSecret,
        },
        body: JSON.stringify({ to: user.email, verification_url: url }),
      }).catch((err) => {
        console.error("[email-verify] Failed to reach backend email service", err);
        return null;
      });

      if (!res?.ok) {
        console.error(`[email-verify] Backend returned ${res?.status} for ${user.email}`);
      }
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "your-google-client-id",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "your-google-client-secret",
    },
  },
});

export type Session = typeof auth.$Infer.Session;
