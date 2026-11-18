import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startVisiblePoll, type PollEnv } from './visible-poll.ts';

// CF-0047: a fake page with a manual clock.
function fakePage() {
  let hidden = false;
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const listeners = new Set<() => void>();
  const env: PollEnv = {
    isHidden: () => hidden,
    onVisible: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setTimer: (cb, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, cb });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    env,
    timers,
    listeners,
    async advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.cb();
        }
      }
      await flush();
    },
    async setHidden(value: boolean) {
      hidden = value;
      if (!value) for (const cb of listeners) cb();
      await flush();
    },
    flush,
  };
}

test('runs now and then every interval while visible', async () => {
  const page = fakePage();
  let runs = 0;
  startVisiblePoll(() => { runs += 1; }, 1000, page.env);
  await page.flush();
  assert.equal(runs, 1);
  await page.advance(999);
  assert.equal(runs, 1);
  await page.advance(1);
  assert.equal(runs, 2);
  await page.advance(1000);
  assert.equal(runs, 3);
});

test('a hidden tab stops polling and polls once when shown again', async () => {
  const page = fakePage();
  let runs = 0;
  startVisiblePoll(() => { runs += 1; }, 1000, page.env);
  await page.flush();
  await page.setHidden(true);
  await page.advance(1000); // the tick finds the tab hidden: no run, no new timer
  await page.advance(5000);
  assert.equal(runs, 1);
  assert.equal(page.timers.size, 0);
  await page.setHidden(false);
  assert.equal(runs, 2);
  await page.advance(1000);
  assert.equal(runs, 3);
});

test('runs never overlap and a failing task keeps polling', async () => {
  const page = fakePage();
  let runs = 0;
  let release: () => void = () => {};
  startVisiblePoll(() => {
    runs += 1;
    if (runs === 1) return new Promise<void>((resolve) => { release = resolve; });
    throw new Error('offline');
  }, 1000, page.env);
  await page.flush();
  await page.setHidden(false); // shown again while the first run is in flight
  assert.equal(runs, 1);
  release();
  await page.flush();
  await page.advance(1000);
  assert.equal(runs, 2); // threw
  await page.advance(1000);
  assert.equal(runs, 3);
});

test('stop clears the timer and the listener', async () => {
  const page = fakePage();
  let runs = 0;
  const stop = startVisiblePoll(() => { runs += 1; }, 1000, page.env);
  await page.flush();
  stop();
  assert.equal(page.timers.size, 0);
  assert.equal(page.listeners.size, 0);
  await page.advance(5000);
  await page.setHidden(false);
  assert.equal(runs, 1);
});
