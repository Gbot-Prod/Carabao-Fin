import { betterAuth } from "better-auth";
import { Pool } from "pg";

const rawPostgresUrl =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRESQL_URL ||
  process.env.PGDATABASE_URL;

const normalizedPostgresUrl = rawPostgresUrl
  ? rawPostgresUrl.trim().replace(/^"|"$/g, "")
  : "";

const postgresUrl =
  normalizedPostgresUrl.includes("render.com") &&
    !normalizedPostgresUrl.includes("sslmode=")
    ? `${normalizedPostgresUrl}${normalizedPostgresUrl.includes("?") ? "&" : "?"
    }sslmode=require`
    : normalizedPostgresUrl;

if (!postgresUrl) {
  throw new Error(
    "Better Auth Postgres URL is missing. Set one of: POSTGRES_URL, DATABASE_URL, POSTGRESQL_URL, or PGDATABASE_URL."
  );
}

if (process.env.NODE_ENV !== "production") {
  try {
    const parsedUrl = new URL(postgresUrl);
    const databaseName = parsedUrl.pathname.replace(/^\//, "") || "(none)";
    console.info(
      `[auth] Better Auth DB target host=${parsedUrl.hostname} db=${databaseName}`
    );
  } catch {
    console.info("[auth] Better Auth DB target could not be parsed");
  }
}

const pool = new Pool({
  connectionString: postgresUrl,
  ssl: postgresUrl.includes("railway.com")
    ? { rejectUnauthorized: false }
    : undefined,
});

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_FASTAPI_URL || "";
const normalizedApiUrl = rawApiUrl.trim().replace(/^"|"$/g, "");
const apiBaseUrl = normalizedApiUrl
  ? normalizedApiUrl.startsWith("http")
    ? normalizedApiUrl
    : `https://${normalizedApiUrl}`
  : "";

export const auth = betterAuth({
  database: pool,
  baseURL:
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000",
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET || "your-secret-key",
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
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
