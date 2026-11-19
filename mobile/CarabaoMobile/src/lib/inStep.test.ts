/// <reference types="node" />
// Run with `npm test`. CF-0106: values that must stay in step (SYSTEM_REFERENCE §3).
// Reads the web and backend source files in this repo, so a change made on one side only
// fails here. When the sides differ, the backend is correct.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from './orderStatus.ts';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_RULE_MESSAGE } from './passwordPolicy.ts';
import { PH_MOBILE_PATTERN } from './phone.ts';
import { HISTORY_PAGE_SIZE, HISTORY_SEARCH_MAX } from './orderHistory.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
// Line ends differ between checkouts (CRLF on Windows): compare text with LF only.
const read = (path: string) => readFileSync(join(repo, path), 'utf8').split('\r\n').join('\n');

test('order statuses = backend OrderStatus enum = web ORDER_STATUSES', () => {
  const py = read('backend/app/models/statuses.py');
  const start = py.indexOf('class OrderStatus(StrEnum):');
  assert.ok(start >= 0, 'OrderStatus enum not found in backend/app/models/statuses.py');
  const next = py.indexOf('\nclass ', start + 1);
  const enumBody = py.slice(start, next < 0 ? undefined : next);
  const backend = [...enumBody.matchAll(/^\s+[A-Z_]+ = "([a-z_]+)"/gm)].map((m) => m[1]);
  assert.deepEqual([...ORDER_STATUSES], backend);

  const web = read('frontend/carabao-app/util/api/statuses.ts');
  const webList = /export const ORDER_STATUSES = \[([\s\S]*?)\] as const/.exec(web)?.[1] ?? '';
  assert.deepEqual([...ORDER_STATUSES], [...webList.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
});

test('order status labels = web ORDER_STATUS_LABELS', () => {
  const web = read('frontend/carabao-app/util/api/statuses.ts');
  const body = /ORDER_STATUS_LABELS: Record<OrderStatus, string> = \{([\s\S]*?)\};/.exec(web)?.[1] ?? '';
  const webLabels = Object.fromEntries([...body.matchAll(/(\w+): '([^']*)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual({ ...ORDER_STATUS_LABELS }, webLabels);
});

test('password policy = web lib/password-policy.ts', () => {
  const web = read('frontend/carabao-app/lib/password-policy.ts');
  assert.match(web, new RegExp(`PASSWORD_MIN_LENGTH = ${PASSWORD_MIN_LENGTH};`));
  assert.match(web, new RegExp(`PASSWORD_MAX_LENGTH = ${PASSWORD_MAX_LENGTH};`));
  assert.ok(web.includes(JSON.stringify(PASSWORD_RULE_MESSAGE)), 'rule message differs');
});

test('phone pattern = web lib/phone.ts', () => {
  const web = read('frontend/carabao-app/lib/phone.ts');
  assert.ok(web.includes(`PH_MOBILE_PATTERN = ${PH_MOBILE_PATTERN.toString()};`), 'pattern differs');
});

test('order history limits = web lib/order-history.ts and backend q max_length', () => {
  const web = read('frontend/carabao-app/lib/order-history.ts');
  assert.match(web, new RegExp(`HISTORY_PAGE_SIZE = ${HISTORY_PAGE_SIZE};`));
  assert.match(web, new RegExp(`HISTORY_SEARCH_MAX = ${HISTORY_SEARCH_MAX};`));
  const py = read('backend/app/api/routes/orders.py');
  const route = py.slice(py.indexOf('"/orders/me/history/page"'));
  assert.match(route.slice(0, 1500), new RegExp(`max_length=${HISTORY_SEARCH_MAX}\\b`));
});
