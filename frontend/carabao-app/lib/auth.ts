import { createHmac, timingSafeEqual } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admin } from "better-auth/plugins";
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

const trustedOrigins = Array.from(
  new Set(
    [
      appBaseUrl,
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.FRONTEND_URL,
      process.env.RAILWAY_PUBLIC_DOMAIN,
      ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || "").split(","),
    ]
      .map(toOrigin)
      .filter((origin): origin is string => Boolean(origin))
  )
);

type SignupVerification = { channel: "email" | "phone"; identifier: string };

// Reads the pre-account OTP token issued by FastAPI's /auth/signup-verification/verify.
// Mirrors read_token in backend/app/services/phone_verification.py.
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
  plugins: [admin()],
  databaseHooks: {
    user: {
      create: {
        // Email/password signups must carry a verified OTP token. An email token
        // proves the address; a phone token does not, so those accounts stay
        // unverified and can't sign in until the emailed link is clicked.
        before: async (user, ctx) => {
          if (ctx?.path !== "/sign-up/email") return;
          const verification = readSignupVerification(ctx.getCookie("pending_signup_verification"));
          if (!verification) {
            throw new APIError("FORBIDDEN", { message: "Verify your email or phone number before signing up." });
          }
          if (verification.channel === "email") {
            if (verification.identifier.trim().toLowerCase() !== user.email.toLowerCase()) {
              throw new APIError("FORBIDDEN", { message: "Verified email does not match signup email." });
            }
            return { data: { ...user, emailVerified: true } };
          }
          return { data: { ...user, emailVerified: false } };
        },
      },
    },
  },
  database: pool,
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  baseURL: appBaseUrl,
  trustedOrigins,
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    // Email-OTP signups are marked verified by the create hook above; phone
    // signups must click the emailed link before they can sign in.
    requireEmailVerification: true,
    // Whoever proves the inbox via a reset kicks out anyone who registered
    // the address first.
    revokeSessionsOnPasswordReset: true,
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
