// src/lib/useResendCooldown.ts
// S17 (plan §5.12): the web hook hooks/useResendCooldown.ts on the phone. The rules are the pure
// functions in src/lib/resendCooldown.ts (tested); this hook keeps the timers and the clock.
// The clock counts from Date.now() rather than ticks, so it stays right after the app was in
// the background. `now` moves twice a second only while a wait runs.
import { useCallback, useEffect, useState } from 'react';
import {
  anyRunning,
  secondsLeft as leftAt,
  startFromError as fromError,
  startTimer,
  type ResendTimers,
} from './resendCooldown';

export function useResendCooldown() {
  const [timers, setTimers] = useState<ResendTimers>({});
  // React's purity lint refuses Date.now() in the render body; the setters below move it.
  const [now, setNow] = useState(0);
  const running = anyRunning(timers, now);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  const start = useCallback((target: string, seconds?: number) => {
    const at = Date.now();
    setNow(at);
    setTimers((prev) => startTimer(prev, target, at, seconds));
  }, []);

  /** After a failed send: start the timer if the server said how long to wait. */
  const startFromError = useCallback((target: string, err: unknown) => {
    const at = Date.now();
    setNow(at);
    setTimers((prev) => fromError(prev, target, err, at));
  }, []);

  /** Seconds until a code may be sent to `target` again; 0 when it may. */
  const secondsLeft = (target: string) => leftAt(timers, target, now);

  return { start, startFromError, secondsLeft };
}
