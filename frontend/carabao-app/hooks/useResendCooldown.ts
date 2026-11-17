"use client";

import { useCallback, useEffect, useState } from "react";
import { OTP_RESEND_SECONDS, formatCountdown, retryAfterFromError } from "@/lib/otp-cooldown";

export { OTP_RESEND_SECONDS, formatCountdown };

/** Applies to every target: the hourly limit is per user, not per number. */
const ANY = "\u0000any";

/**
 * The site-wide OTP resend timer. Once a code goes to `target` (a number, an
 * email, a payout destination), resending to it waits OTP_RESEND_SECONDS and
 * the page shows the countdown. Each target has its own timer, like the
 * server's wait, so a corrected number can get a code at once.
 *
 * A refused send (429) restarts the timer from the server's wait, e.g. after a
 * reload. A wait longer than the cooldown is the hourly limit (5 codes per user
 * per channel), which holds for every target, so it blocks them all.
 *
 * Counts from the clock rather than ticks, so it stays right in a background tab.
 */
export function useResendCooldown() {
  const [timers, setTimers] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const running = Object.values(timers).some((until) => until > now);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  const start = useCallback((target: string, seconds: number = OTP_RESEND_SECONDS) => {
    const at = Date.now();
    setNow(at);
    setTimers((prev) => {
      // Drop finished timers so the map stays small.
      const kept = Object.fromEntries(Object.entries(prev).filter(([, until]) => until > at));
      return { ...kept, [target]: at + seconds * 1000 };
    });
  }, []);

  /** After a failed send: start the timer if the server said how long to wait. */
  const startFromError = useCallback(
    (target: string, err: unknown) => {
      const wait = retryAfterFromError(err);
      if (!wait) return;
      start(wait > OTP_RESEND_SECONDS ? ANY : target, wait);
    },
    [start],
  );

  /** Seconds until a code may be sent to `target` again; 0 when it may. */
  const secondsLeft = (target: string) => {
    const until = Math.max(timers[target] ?? 0, timers[ANY] ?? 0);
    return Math.max(0, Math.ceil((until - now) / 1000));
  };

  return { start, startFromError, secondsLeft };
}
