// Merchant copy of mobile/CarabaoMobile/src/lib/inStep.test.ts. The checks for files this app
// does not have are left out: orderHistory and orderDetail (CF-0128 x2), checkoutOptions and
// vouchers (CF-0131). The CF-0133 reply check imports ./myReviews.ts.
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
import {
  BODY_LIMIT_BYTES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  ONBOARDING_BODY_LIMIT_BYTES,
} from './uploads.ts';

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

test('CF-0133 review reply max length = backend REPLY_MAX_LENGTH = web lib/review-reply.ts', async () => {
  const { REPLY_MAX_LENGTH } = await import('./myReviews.ts');
  const py = read('backend/app/schemas/review.py');
  assert.equal(Number(/^REPLY_MAX_LENGTH = (\d+)$/m.exec(py)?.[1]), REPLY_MAX_LENGTH);
  assert.match(py, /reply: str = Field\(min_length=1, max_length=REPLY_MAX_LENGTH\)/);
  const web = read('frontend/carabao-app/lib/review-reply.ts');
  assert.equal(Number(/REPLY_MAX_LENGTH = (\d+);/.exec(web)?.[1]), REPLY_MAX_LENGTH);
  assert.match(web, /'Write a reply first\.'/);
  // Web "Reply from {farm}" (en.ts shop.farmReply) is the farm-screen label.
  assert.match(read('frontend/carabao-app/lib/i18n/strings/en.ts'), /farmReply: 'Reply from \{farm\}'/);
});

test('image types = web ProduceTab photo input', () => {
  const web = read('frontend/carabao-app/app/(site)/(merchant)/merchant/components/ProduceTab.tsx');
  assert.ok(web.includes(`accept="${IMAGE_TYPES.join(',')}"`), 'accept list differs');
});

test('document upload rules = web DocumentDropzone.tsx', () => {
  const web = read('frontend/carabao-app/app/(site)/(merchant)/merchant/onboarding/DocumentDropzone.tsx');
  const types = /export const DOCUMENT_TYPES = \[([^\]]*)\]/.exec(web)?.[1] ?? '';
  assert.deepEqual([...DOCUMENT_TYPES], [...types.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]));
  const max = /export const DOCUMENT_MAX_BYTES = ([\d\s*]+);/.exec(web)?.[1] ?? '';
  assert.equal(max.split('*').reduce((n, part) => n * Number(part.trim()), 1), DOCUMENT_MAX_BYTES);
  // The words documentError shows; uploads.ts must show the same.
  assert.ok(web.includes('`${label} must be a PDF or an image (PNG/JPG/WEBP).`'), 'type message differs');
  assert.ok(web.includes('`${label} must be 10MB or smaller.`'), 'size message differs');
});

test('upload and body limits = backend constants = SYSTEM_REFERENCE 7.4', () => {
  const MB = 1024 * 1024;
  const body = read('backend/app/core/body_limit.py');
  assert.equal(Number(/^DEFAULT_MAX_BODY = (\d+) \* MB$/m.exec(body)?.[1]) * MB, BODY_LIMIT_BYTES);
  assert.equal(
    Number(/"\/merchant-onboarding\/me": (\d+) \* MB/.exec(body)?.[1]) * MB,
    ONBOARDING_BODY_LIMIT_BYTES,
  );
  const uploads = read('backend/app/services/upload_validation.py');
  assert.equal(Number(/^IMAGE_MAX_BYTES = (\d+) \* MB$/m.exec(uploads)?.[1]) * MB, IMAGE_MAX_BYTES);
  // SYSTEM_REFERENCE.md 7.4, "Body limits".
  assert.match(
    read('documentation/manuals/SYSTEM_REFERENCE.md'),
    new RegExp(
      `Body limits:\\*\\* ${BODY_LIMIT_BYTES / MB} MB by default; ${ONBOARDING_BODY_LIMIT_BYTES / MB} MB for \`/merchant-onboarding/me\``,
    ),
  );
});

test('S3 badge status sets = web MerchantShell.tsx and its hooks', async () => {
  const { ACTIVE_ORDER_STATUSES, READY_TO_SHIP_STATUS } = await import('./badges.ts');
  const shell = read('frontend/carabao-app/app/(site)/(merchant)/merchant/MerchantShell.tsx');
  // The shell draws the same four counts badges.ts provides, with the same alert tones.
  assert.ok(shell.includes('count: activeOrderCount || undefined'), 'Orders count differs');
  assert.ok(
    shell.includes('count: chatsState.unreadCount || undefined, countTone: "alert"'),
    'Chats count differs',
  );
  assert.ok(shell.includes('const readyCount = ordersState.readyToShip.length;'), 'ready count differs');
  assert.ok(
    shell.includes('count: readyCount || undefined, countTone: "alert"'),
    'Shipments count differs',
  );
  assert.ok(shell.includes('count: productCount || undefined'), 'Produce count differs');

  // Orders = the active statuses (M/MerchantContext.tsx).
  const context = read('frontend/carabao-app/app/(site)/(merchant)/merchant/MerchantContext.tsx');
  const webActive = /const ACTIVE_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>\(\[([\s\S]*?)\]\);/
    .exec(context)?.[1] ?? '';
  assert.deepEqual([...ACTIVE_ORDER_STATUSES], [...webActive.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

  // Shipments = processing, not shipped and not on a route (M/hooks/useMerchantOrders.ts).
  const orders = read('frontend/carabao-app/app/(site)/(merchant)/merchant/hooks/useMerchantOrders.ts');
  assert.ok(
    orders.includes(`o.status === "${READY_TO_SHIP_STATUS}" && !o.shipped && o.shipment_id == null;`),
    'ready-to-ship status differs',
  );
});

