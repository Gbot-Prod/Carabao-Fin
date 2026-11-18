"use client";

import { useEffect } from 'react';
import { startVisiblePoll, type PollEnv } from '@/lib/visible-poll';

const browserEnv: PollEnv = {
  isHidden: () => document.hidden,
  onVisible: (cb) => {
    const handler = () => {
      if (!document.hidden) cb();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
  setTimer: (cb, ms) => window.setTimeout(cb, ms),
  clearTimer: (id) => window.clearTimeout(id as number | undefined),
};

/**
 * CF-0047: calls `task` now and every `intervalMs` while the tab is visible
 * (lib/visible-poll.ts). Use it for side-effect polls (toasts, chat); for a
 * poll whose result you only render, use useVisiblePoll. Pass a stable `task`
 * (useCallback): a new identity restarts the poll. `enabled=false` stops it.
 */
export function useVisibleInterval(
  task: () => Promise<unknown> | unknown,
  intervalMs: number,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    return startVisiblePoll(task, intervalMs, browserEnv);
  }, [task, intervalMs, enabled]);
}
