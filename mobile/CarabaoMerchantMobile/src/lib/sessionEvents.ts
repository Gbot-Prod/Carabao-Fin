// Shared with mobile/CarabaoMobile/src/lib/sessionEvents.ts. Keep both copies the same (sharedCopies.test.ts).
// CF-0120: the API client tells the auth layer when the session is gone (a 401
// that survives the token refresh, or a refresh that fails), so the app signs out
// once and cleanly instead of every screen showing its own error. Pure, for `npm test`.

type Listener = () => void;
const listeners = new Set<Listener>();
let lastEmit = 0;
const QUIET_MS = 5_000; // many requests fail at once: sign out only once

export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the API client. `now` is for tests. */
export function emitSessionExpired(now: number = Date.now()): boolean {
  if (now - lastEmit < QUIET_MS) return false;
  lastEmit = now;
  for (const l of [...listeners]) l();
  return true;
}

/** True when a failed signed-in call means the session is gone. */
export function sessionGone(status: number, hadToken: boolean, afterRefresh: boolean): boolean {
  return hadToken && afterRefresh && status === 401;
}

/** Tests only. */
export function resetSessionEventsForTest(): void {
  listeners.clear();
  lastEmit = 0;
}
