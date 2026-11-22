// The site-wide OTP rules shared by the server (lib/auth.ts) and the pages
// (hooks/useResendCooldown.ts). Plain functions with no "@/" imports, so
// `node --test` can run the tests.
//
// Keep in step with the backend: app/services/otp.py OTP_RESEND_COOLDOWN_SECONDS
// (60 s between codes to one target) and app/services/rate_limit.py (5 codes an
// hour per user per channel).

/** Seconds to wait after a code is sent before another goes to the same target. */
export const OTP_RESEND_SECONDS = 60;

/**
 * The verification rows BetterAuth's phoneNumber plugin writes (1.7.26,
 * plugins/phone-number/routes.mjs phoneNumberOTPIdentifier and
 * phoneNumberResetIdentifier). Recheck when BetterAuth is upgraded: a wrong
 * name silently turns the resend wait off.
 */
export const phoneOtpIdentifier = (phone: string) => `phone-number-otp-${phone}`;
export const phoneResetIdentifier = (phone: string) => `phone-number-reset-${phone}`;

/**
 * Written instead of a reset code when the number belongs to an admin (lib/auth.ts
 * noAdminsOnPublicSurface), so the resend wait looks the same as for any other number.
 */
export const adminResetWaitIdentifier = (phone: string) => `phone-reset-wait-${phone}`;

/** BetterAuth endpoints that text a code, and the verification rows that start the wait. */
export const OTP_SEND_PATHS: Record<string, (phoneNumber: string) => string[]> = {
  "/phone-number/send-otp": (phone) => [phoneOtpIdentifier(phone)],
  "/phone-number/request-password-reset": (phone) => [phoneResetIdentifier(phone), adminResetWaitIdentifier(phone)],
};

/** Seconds left before another code may go out, or 0. `lastSentAt` is the newest code's time. */
export function resendWaitSeconds(
  lastSentAt: Date | string | null | undefined,
  now: Date = new Date(),
  cooldownSeconds: number = OTP_RESEND_SECONDS,
): number {
  if (!lastSentAt) return 0;
  const readyAt = new Date(lastSentAt).getTime() + cooldownSeconds * 1000;
  const left = Math.ceil((readyAt - now.getTime()) / 1000);
  return left > 0 ? Math.min(left, cooldownSeconds) : 0;
}

/**
 * Seconds to wait from a refused send, or null when the error isn't a "too
 * soon / too many" refusal. Reads, in order: a `retryAfter` field (BetterAuth
 * errors from lib/auth.ts), the Retry-After header (backend axios errors), and
 * "in N seconds / minutes" in the message.
 */
export function retryAfterFromError(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as {
    retryAfter?: unknown;
    status?: unknown;
    message?: unknown;
    response?: { status?: number; headers?: Record<string, unknown>; data?: { detail?: unknown } };
  };
  const positive = (value: unknown) => {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
  };
  const direct = positive(e.retryAfter);
  if (direct) return direct;
  const status = e.response?.status ?? e.status;
  const header = positive(e.response?.headers?.["retry-after"]);
  if (status === 429 && header) return header;
  const text = typeof e.response?.data?.detail === "string" ? e.response.data.detail : e.message;
  if (typeof text === "string") {
    const match = /\b(?:in|wait)\s+(\d+)\s+(second|minute)s?\b/i.exec(text);
    if (match) return Number(match[1]) * (match[2].toLowerCase() === "minute" ? 60 : 1);
  }
  return null;
}

/** "0:45" for 45 seconds, "12:00" for 720. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
