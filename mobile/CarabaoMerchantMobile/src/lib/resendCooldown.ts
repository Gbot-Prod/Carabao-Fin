// src/lib/resendCooldown.ts
// S17 (plan §5.12): the site-wide OTP resend timer of the web hook
// (frontend/carabao-app/hooks/useResendCooldown.ts and lib/otp-cooldown.ts) as pure functions,
// so `node --test` can run them. src/lib/useResendCooldown.ts holds the state and the clock.
//
// Once a code goes to a target (a number, an email), resending to it waits OTP_RESEND_SECONDS
// and the screen shows the countdown. Each target has its own timer, like the server's wait, so
// a corrected number can get a code at once. A refused send (429) restarts the timer from the
// server's wait. A wait longer than the cooldown is the hourly limit (5 codes per user per
// channel), which holds for every target, so it blocks them all.
//
// Keep in step with the backend: app/services/otp.py OTP_RESEND_COOLDOWN_SECONDS (inStep.test.ts).

/** Seconds to wait after a code is sent before another goes to the same target. */
export const OTP_RESEND_SECONDS = 60;

/** Applies to every target: the hourly limit is per user, not per number. */
export const ANY_TARGET = '\u0000any';

/** target -> the moment (ms) a code may go to it again. */
export type ResendTimers = Record<string, number>;

/** The timers after a code went to `target` at `now`; finished timers are dropped. */
export function startTimer(
  timers: ResendTimers,
  target: string,
  now: number,
  seconds: number = OTP_RESEND_SECONDS,
): ResendTimers {
  const kept = Object.fromEntries(Object.entries(timers).filter(([, until]) => until > now));
  return { ...kept, [target]: now + seconds * 1000 };
}

/**
 * Seconds to wait from a refused send, or null when the error isn't a "too soon / too many"
 * refusal. The web's retryAfterFromError, read for read: a `retryAfter` field, the
 * Retry-After header, then "in N seconds / minutes" in the message. This app's ApiError
 * carries the status and the server's words ("Please wait 42 seconds before requesting
 * another code."), not the headers, so the message is what it reads in practice.
 */
export function retryAfterFromError(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as {
    retryAfter?: unknown;
    status?: unknown;
    message?: unknown;
    response?: { status?: number; headers?: Record<string, unknown>; data?: { detail?: unknown } };
  };
  const positive = (value: unknown) => {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
  };
  const direct = positive(e.retryAfter);
  if (direct) return direct;
  const status = e.response?.status ?? e.status;
  const header = positive(e.response?.headers?.['retry-after']);
  if (status === 429 && header) return header;
  const text = typeof e.response?.data?.detail === 'string' ? e.response.data.detail : e.message;
  if (typeof text === 'string') {
    const match = /\b(?:in|wait)\s+(\d+)\s+(second|minute)s?\b/i.exec(text);
    if (match) return Number(match[1]) * (match[2].toLowerCase() === 'minute' ? 60 : 1);
  }
  return null;
}

/** After a failed send: the timers with the server's wait, or the same timers when it gave none. */
export function startFromError(
  timers: ResendTimers,
  target: string,
  err: unknown,
  now: number,
): ResendTimers {
  const wait = retryAfterFromError(err);
  if (!wait) return timers;
  return startTimer(timers, wait > OTP_RESEND_SECONDS ? ANY_TARGET : target, now, wait);
}

/** Seconds until a code may be sent to `target` again; 0 when it may. */
export function secondsLeft(timers: ResendTimers, target: string, now: number): number {
  const until = Math.max(timers[target] ?? 0, timers[ANY_TARGET] ?? 0);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** True while any timer runs (the hook ticks the clock only then). */
export const anyRunning = (timers: ResendTimers, now: number): boolean =>
  Object.values(timers).some((until) => until > now);

/** "0:45" for 45 seconds, "12:00" for 720 (web lib/otp-cooldown.ts formatCountdown). */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
