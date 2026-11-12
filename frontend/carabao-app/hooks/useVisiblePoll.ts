"use client";

import { useCallback, useEffect, useState } from 'react';

type PollResult<T> = {
  /** The fetcher this result came from, so a stale result is never shown for a new one. */
  source: unknown;
  data: T | null;
  error: unknown;
  updatedAt: number | null;
};

export type VisiblePoll<T> = {
  data: T | null;
  error: unknown;
  /** True once the first request for the current fetcher has finished. */
  loaded: boolean;
  /** Client time of the last successful response. */
  updatedAt: number | null;
  /** Poll again now (also after an error). */
  retry: () => void;
};

/**
 * Calls `fetcher` now and then every `intervalMs` while the tab is visible,
 * resuming as soon as it becomes visible again, until `isDone(data)` is true.
 *
 * Pass a stable `fetcher` (useCallback) and a module-level `isDone`; a new
 * identity restarts polling. A null fetcher means "nothing to poll yet".
 */
export function useVisiblePoll<T>(
  fetcher: (() => Promise<T>) | null,
  isDone: (data: T) => boolean,
  intervalMs = 30_000,
): VisiblePoll<T> {
  const [result, setResult] = useState<PollResult<T> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!fetcher) return;
    let active = true;
    let inFlight = false;
    let done = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timerId);
      if (active && !done) timerId = setTimeout(() => void poll(), intervalMs);
    };

    const poll = async () => {
      if (!active || inFlight || done) return;
      // Hidden tab: stop here; the visibilitychange handler picks it back up.
      if (document.hidden) return;
      inFlight = true;
      try {
        const data = await fetcher();
        if (!active) return;
        done = isDone(data);
        setResult({ source: fetcher, data, error: null, updatedAt: Date.now() });
      } catch (error) {
        if (!active) return;
        // Keep the last good data on screen; a later poll may succeed.
        setResult((prev) => ({
          source: fetcher,
          data: prev?.source === fetcher ? prev.data : null,
          error,
          updatedAt: prev?.source === fetcher ? prev.updatedAt : null,
        }));
      } finally {
        inFlight = false;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) return;
      clearTimeout(timerId);
      void poll();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    void poll();

    return () => {
      active = false;
      clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetcher, isDone, intervalMs, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = fetcher && result?.source === fetcher ? result : null;

  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loaded: current !== null,
    updatedAt: current?.updatedAt ?? null,
    retry,
  };
}
