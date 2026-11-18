// CF-0047 (B43): run a task now and then every `intervalMs` while the page is
// visible. A hidden tab stops polling and polls once as soon as it is shown
// again. Runs never overlap: the next one is timed from the end of the last.
// Pure (no DOM access) so node tests can drive it; hooks/useVisibleInterval.ts
// gives it the browser.

export type PollEnv = {
  isHidden: () => boolean;
  /** Calls `cb` when the page becomes visible; returns an unsubscribe. */
  onVisible: (cb: () => void) => () => void;
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
};

/** Starts polling; returns a stop function. */
export function startVisiblePoll(
  task: () => Promise<unknown> | unknown,
  intervalMs: number,
  env: PollEnv,
): () => void {
  let active = true;
  let inFlight = false;
  let timer: unknown;

  const schedule = () => {
    env.clearTimer(timer);
    if (active) timer = env.setTimer(() => void run(), intervalMs);
  };

  const run = async () => {
    if (!active || inFlight) return;
    // Hidden: do not reschedule; onVisible starts it again.
    if (env.isHidden()) return;
    inFlight = true;
    try {
      await task();
    } catch {
      // The task owns its errors; a failure must not stop the polling.
    } finally {
      inFlight = false;
      schedule();
    }
  };

  const unsubscribe = env.onVisible(() => {
    env.clearTimer(timer);
    void run();
  });
  void run();

  return () => {
    active = false;
    env.clearTimer(timer);
    unsubscribe();
  };
}
