// Require sign-in again after the app has been in the background too long (E5).
// Same limit as the web: EXPO_PUBLIC_IDLE_TIMEOUT_MINUTES, default 30.

const DEFAULT_TIMEOUT_MINUTES = 30;

export function idleTimeoutMs(raw: string | undefined = process.env.EXPO_PUBLIC_IDLE_TIMEOUT_MINUTES): number {
  const minutes = Number(raw);
  return (Number.isFinite(minutes) && minutes >= 1 ? minutes : DEFAULT_TIMEOUT_MINUTES) * 60_000;
}

/** True when the app left the foreground at `leftAt` and has been away too long. */
export function awayTooLong(leftAt: number | null, now: number, timeoutMs: number): boolean {
  return leftAt !== null && now - leftAt >= timeoutMs;
}
