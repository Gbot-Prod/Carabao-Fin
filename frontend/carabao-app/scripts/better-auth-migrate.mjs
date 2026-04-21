import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";

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

const rawPostgresUrl =
  env.POSTGRES_URL ||
  env.DATABASE_URL ||
  env.POSTGRESQL_URL ||
  env.PGDATABASE_URL;

const normalizedPostgresUrl = rawPostgresUrl
  ? rawPostgresUrl.trim().replace(/^"|"$/g, "")
  : "";

const postgresUrl =
  normalizedPostgresUrl.includes("render.com") &&
    !normalizedPostgresUrl.includes("sslmode=")
    ? `${normalizedPostgresUrl}${normalizedPostgresUrl.includes("?") ? "&" : "?"}sslmode=require`
    : normalizedPostgresUrl;

if (!postgresUrl) {
  throw new Error(
    "Better Auth Postgres URL is missing. Set one of: POSTGRES_URL, DATABASE_URL, POSTGRESQL_URL, or PGDATABASE_URL."
  );
}

const pool = new Pool({
  connectionString: postgresUrl,
  ssl: postgresUrl.includes("render.com")
    ? { rejectUnauthorized: false }
    : undefined,
});

const config = {
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

const shouldApply = process.argv.includes("--apply");

try {
  const migrations = await getMigrations(config);

  if (migrations.toBeCreated.length === 0 && migrations.toBeAdded.length === 0) {
    console.log("Better Auth schema is already up to date.");
  } else if (shouldApply) {
    await migrations.runMigrations();
    console.log("Better Auth migrations applied successfully.");
  } else {
    const sql = await migrations.compileMigrations();
    console.log("Pending Better Auth SQL:\n");
    console.log(sql);
    console.log("\nRun with --apply to execute these migrations.");
  }
} finally {
  await pool.end();
}
