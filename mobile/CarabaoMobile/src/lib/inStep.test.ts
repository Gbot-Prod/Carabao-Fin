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
import { HIDDEN_REVIEW_NOTICE } from './orderDetail.ts';
import { placeOrderFailure } from './checkoutOptions.ts';
import { CODE_PATTERN, VOUCHER_CODE_MAX, VOUCHER_TEXT } from './vouchers.ts';

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

test('CF-0128 hidden review notice = web order page text (M62)', () => {
  const web = read('frontend/carabao-app/app/(site)/(app)/orders/[orderId]/page.tsx').replace(/\s+/g, ' ');
  assert.ok(web.includes(HIDDEN_REVIEW_NOTICE), 'web notice text changed');
});

test('CF-0128 holiday farm refusal: backend 400 text is shown as is (M63)', () => {
  const route = read('backend/app/api/routes/orders.py');
  assert.match(route, /status_code=400, detail=store_pause\.pause_detail\(merchant\)/);
  assert.match(read('backend/app/services/store_pause.py'), /is on a break and takes orders again after/);
  const text = 'Mang Ben Farm is on a break and takes orders again after Dec 3. Remove their items from your cart to continue.';
  assert.deepEqual(placeOrderFailure(400, text), { text, reloadCart: true });
});

test('CF-0131 voucher code rules = web lib/vouchers.ts, texts = web en.ts, max = backend (M52, M65)', () => {
  const web = read('frontend/carabao-app/lib/vouchers.ts');
  assert.ok(web.includes(`CODE_PATTERN = /${CODE_PATTERN.source}/;`), 'web CODE_PATTERN changed');
  const py = read('backend/app/services/vouchers.py');
  assert.ok(py.includes(`CODE_PATTERN = re.compile(r"${CODE_PATTERN.source}")`), 'backend CODE_PATTERN changed');
  const schema = read('backend/app/schemas/order.py');
  assert.ok(schema.includes(`voucher_code: str = Field(min_length=1, max_length=${VOUCHER_CODE_MAX})`), 'preview max changed');
  assert.ok(schema.includes(`voucher_code: str | None = Field(default=None, max_length=${VOUCHER_CODE_MAX})`), 'place-order max changed');
  const en = read('frontend/carabao-app/lib/i18n/strings/en.ts');
  const webKeys = { label: 'voucherLabel', apply: 'voucherApply', checking: 'voucherChecking', remove: 'voucherRemove', badCode: 'voucherBadCode', error: 'voucherError' } as const;
  for (const [k, webKey] of Object.entries(webKeys)) {
    assert.ok(en.includes(`${webKey}: '${VOUCHER_TEXT[k as keyof typeof VOUCHER_TEXT]}',`), `web ${webKey} changed`);
  }
  assert.ok(en.includes("voucherApplied: '{code} applied: PHP {amount} off {farm}',"));
  assert.ok(en.includes("voucherDiscount: 'Voucher ({code})',"));
});
