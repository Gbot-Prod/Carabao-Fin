import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getMigrations } from "better-auth/db/migration";
import { admin, jwt, phoneNumber, twoFactor } from "better-auth/plugins";
import { Pool } from "pg";

import { poolConfigFromUrl } from "../lib/db-ssl.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");

const readEnvLocal = () => {
  const envPath = path.join(appRoot, ".env.local");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const text = fs.readFileSync(envPath, "utf8");
  const out = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    out[key] = value;
  }

  return out;
};

const envFile = readEnvLocal();
const env = { ...envFile, ...process.env };

const rawPostgresUrl = env.DATABASE_URL;

const normalizedPostgresUrl = rawPostgresUrl
  ? rawPostgresUrl.trim().replace(/^"|"$/g, "")
  : "";

if (!normalizedPostgresUrl) {
  throw new Error(
    "Better Auth Postgres URL is missing. Set DATABASE_URL."
  );
}

// Same TLS rules as lib/auth.ts (CF-0001): the server cert is always verified.
const pool = new Pool(poolConfigFromUrl(normalizedPostgresUrl, env));

const config = {
  // Keep in step with lib/auth.ts (schema-bearing plugins and fields only).
  // phoneNumber adds "phoneNumber" (unique) and "phoneNumberVerified"; the
  // backend migration c3e8a1f5d7b9 adds the unique index on an existing column.
  plugins: [
    admin(),
    twoFactor(),
    jwt(),
    phoneNumber({ sendOTP: () => {} }),
    // lib/auth.ts adminTwoFactor(): the session passed the code step (CF-0017).
    {
      id: "carabao-admin-two-factor",
      schema: { session: { fields: { mfaVerified: { type: "boolean", required: false, input: false } } } },
    },
    // lib/auth.ts phoneChangeHistory(): the number before the last change (CF-0019).
    {
      id: "carabao-phone-change-history",
      schema: {
        user: {
          fields: {
            previousPhoneNumber: { type: "string", required: false, input: false },
            phoneNumberChangedAt: { type: "date", required: false, input: false },
          },
        },
      },
    },
  ],
  database: pool,
  baseURL:
    env.NEXT_PUBLIC_APP_URL || env.BETTER_AUTH_URL || "http://localhost:3000",
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET || "your-secret-key",
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID || "your-google-client-id",
      clientSecret: env.GOOGLE_CLIENT_SECRET || "your-google-client-secret",
    },
  },
};

// The admin deploy (APP_SURFACE=admin) keeps its JWT keys in "jwks_admin"
// (lib/auth.ts). One config has one "jwks" model, so this is a second pass
// with only that plugin. Migrations only add tables and columns, so it adds
// "jwks_admin" and nothing else.
const adminJwksConfig = {
  ...config,
  plugins: [jwt({ schema: { jwks: { modelName: "jwks_admin" } } })],
};

const shouldApply = process.argv.includes("--apply");

try {
  for (const [name, cfg] of [
    ["public", config],
    ["admin JWT keys (jwks_admin)", adminJwksConfig],
  ]) {
    const migrations = await getMigrations(cfg);

    if (migrations.toBeCreated.length === 0 && migrations.toBeAdded.length === 0) {
      console.log(`[${name}] Better Auth schema is already up to date.`);
    } else if (shouldApply) {
      await migrations.runMigrations();
      console.log(`[${name}] Better Auth migrations applied successfully.`);
    } else {
      const sql = await migrations.compileMigrations();
      console.log(`[${name}] Pending Better Auth SQL:\n`);
      console.log(sql);
      console.log("\nRun with --apply to execute these migrations.");
    }
  }
} finally {
  await pool.end();
}
