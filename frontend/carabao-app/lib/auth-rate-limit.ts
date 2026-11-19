// Better Auth's per-IP rate limits (E7), as one testable function (CF-0080).
// lib/auth.ts passes the result to betterAuth({ rateLimit }). The per-number SMS
// limit lives in the FastAPI backend (app/services/rate_limit.py).

export type AuthRateLimitStorage = "memory" | "database";

type Rule = { window: number; max: number };

export const AUTH_RATE_RULES: Record<string, Rule> = {
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
  // CF-0080: the admin second step. Better Auth 1.7 also locks a user after
  // wrong codes; this caps guesses per IP on top of that.
  "/two-factor/verify-totp": { window: 900, max: 10 },
  "/two-factor/verify-backup-code": { window: 900, max: 10 },
  "/two-factor/verify-otp": { window: 900, max: 10 },
};

type Env = Record<string, string | undefined>;

/**
 * "memory" (default) counts per server process: a deploy or restart resets it,
 * and each replica counts on its own. "database" keeps the counts in Better
 * Auth's `rateLimit` table, so they hold across restarts and replicas. Set
 * BETTER_AUTH_RATE_LIMIT_STORAGE=database only after `npm run auth:migrate:apply`
 * has created that table: without it every limited request fails.
 */
export function authRateLimitStorage(env: Env): AuthRateLimitStorage {
  return (env.BETTER_AUTH_RATE_LIMIT_STORAGE || "").trim().toLowerCase() === "database" ? "database" : "memory";
}

export function authRateLimit(env: Env) {
  return {
    enabled: env.NODE_ENV === "production" || env.BETTER_AUTH_RATE_LIMIT === "true",
    window: 60,
    max: 100,
    storage: authRateLimitStorage(env),
    customRules: AUTH_RATE_RULES,
  };
}
