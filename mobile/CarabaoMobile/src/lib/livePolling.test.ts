/// <reference types="node" />
// Run with `npm test`. CF-0134.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldPollChat, shouldRefreshTracking, TRACKING_POLL_MS } from './livePolling.ts';
import { CLOSED_ORDER_STATUSES } from './orderStatus.ts';

test('CF-0134 tracking refreshes only a shipped order that is not finished', () => {
  assert.equal(shouldRefreshTracking(undefined, null), false);
  assert.equal(shouldRefreshTracking({ shipped: false, status: 'processing' }, null), false);
  assert.equal(shouldRefreshTracking({ shipped: true, status: 'shipped' }, null), true);
  assert.equal(shouldRefreshTracking({ shipped: true, status: 'shipped' }, { status: 'out_for_delivery' }), true);
  for (const s of ['delivered', 'cancelled', 'payment_mismatch']) {
    assert.equal(shouldRefreshTracking({ shipped: true, status: s }, null), false, s);
    // the newest tracking answer wins over the older order list
    assert.equal(shouldRefreshTracking({ shipped: true, status: 'shipped' }, { status: s }), false, s);
  }
});

test('CF-0134 a closed chat stops polling', () => {
  assert.equal(shouldPollChat(true, false), true);
  assert.equal(shouldPollChat(true, true), false);
  assert.equal(shouldPollChat(false, false), false);
});

test('CF-0134 interval and closed statuses match the web', () => {
  const web = (p: string) => readFileSync(new URL(`../../../../frontend/carabao-app/${p}`, import.meta.url), 'utf8');
  assert.equal(TRACKING_POLL_MS, 30_000);
  assert.match(web('app/(site)/(app)/track/page.tsx'), /const POLL_MS = 30_000;/);
  const m = web('util/api/statuses.ts').match(/CLOSED_ORDER_STATUSES[^=]*=\s*\[([^\]]*)\]/);
  assert.ok(m);
  assert.deepEqual([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]), [...CLOSED_ORDER_STATUSES]);
});
