// Inactivity sign-out (E5). The experts asked for automatic logout; the
// timeout is configurable with NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES (default 30).

const DEFAULT_TIMEOUT_MINUTES = 30;
export const WARNING_MS = 60_000; // warn one minute before signing out

export function idleTimeoutMs(raw: string | undefined = process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES): number {
  const minutes = Number(raw);
  // Anything shorter than two minutes would leave no time for the warning.
  return (Number.isFinite(minutes) && minutes >= 2 ? minutes : DEFAULT_TIMEOUT_MINUTES) * 60_000;
}

export type IdleState = "active" | "warning" | "expired";

/** Where the session stands, given the last activity time (any tab). */
export function idleState(now: number, lastActivity: number, timeoutMs: number, warningMs = WARNING_MS): IdleState {
  const idle = now - lastActivity;
  if (idle >= timeoutMs) return "expired";
  if (idle >= timeoutMs - warningMs) return "warning";
  return "active";
}

/** Whole seconds left before sign-out (never negative). */
export function secondsLeft(now: number, lastActivity: number, timeoutMs: number): number {
  return Math.max(0, Math.ceil((lastActivity + timeoutMs - now) / 1000));
}
