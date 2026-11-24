// Merchant copy of mobile/CarabaoMobile/src/lib/inStep.test.ts. The checks for files this app
// does not have are left out: orderHistory and orderDetail (CF-0128 x2), checkoutOptions and
// vouchers (CF-0131). The CF-0133 reply check imports ./myReviews.ts. S15's voucher rules are
// here (the app now has the screen the CF-0131 check was left out for).
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
import {
  canCancel,
  MERCHANT_CANCEL_NOTE_MAX,
  MERCHANT_CANCEL_REASONS,
  nextStatuses,
  ORDER_FILTERS,
  orderCounts,
  orderFilter,
} from './orderActions.ts';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_RULE_MESSAGE } from './passwordPolicy.ts';
import { PH_MOBILE_PATTERN } from './phone.ts';
import { LISTING_NAME_MAX } from './listingForm.ts';
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

test('S6 produce name limit and photo part = web input-limits.ts and util/api/produce.ts', () => {
  // The web name box stops at PRODUCE_NAME_MAX (ProduceFormFields.tsx); the phone's
  // checkListing stops at the same count, so neither client sends a name the server
  // refuses (the backend MAX_NAME side is checked in listingForm.test.ts).
  const limits = read('frontend/carabao-app/lib/input-limits.ts');
  assert.equal(Number(/export const PRODUCE_NAME_MAX = (\d+);/.exec(limits)?.[1]), LISTING_NAME_MAX);
  assert.match(
    read('frontend/carabao-app/app/(site)/(merchant)/merchant/components/ProduceFormFields.tsx'),
    /maxLength=\{PRODUCE_NAME_MAX\}/,
  );
  // api.produce.uploadImage sends the multipart part the web's uploadProduceImage sends.
  assert.ok(
    read('frontend/carabao-app/util/api/produce.ts').includes("formData.append('image', file);"),
    'the web upload part differs',
  );
  assert.ok(
    read('mobile/CarabaoMerchantMobile/src/lib/api.ts').includes("form.append('image', file"),
    'the phone upload part differs',
  );
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

test('S4 cancel reasons and note max = web merchants.ts = backend order_status.py', () => {
  const web = read('frontend/carabao-app/util/api/merchants.ts');
  const block = /export const MERCHANT_CANCEL_REASONS = \[([\s\S]*?)\] as const;/.exec(web)?.[1] ?? '';
  const webReasons = [...block.matchAll(/\{ key: "([a-z_]+)", label: "([^"]*)" \}/g)].map((m) => ({
    key: m[1],
    label: m[2],
  }));
  assert.deepEqual([...MERCHANT_CANCEL_REASONS], webReasons);

  const webMax = /export const MERCHANT_CANCEL_NOTE_MAX = (\d+);/.exec(web)?.[1];
  assert.equal(Number(webMax), MERCHANT_CANCEL_NOTE_MAX);

  // The backend stores the same keys (its values are the buyer-facing wording).
  const backend = read('backend/app/services/order_status.py');
  const pyBlock = /MERCHANT_CANCEL_REASONS: dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(backend)?.[1] ?? '';
  assert.deepEqual([...pyBlock.matchAll(/^\s+"([a-z_]+)":/gm)].map((m) => m[1]), webReasons.map((r) => r.key));
});

test('S4 nextStatuses = backend merchant transitions = web order buttons', () => {
  // The server enforces the map (MERCHANT_TRANSITIONS in order_status.py).
  const backend = read('backend/app/services/order_status.py');
  const start = backend.indexOf('MERCHANT_TRANSITIONS: dict[OrderStatus, frozenset[OrderStatus]] = {');
  const block = backend.slice(start, backend.indexOf('\n}', start));
  const pyTransitions: Record<string, string[]> = {};
  for (const m of block.matchAll(/OrderStatus\.([A-Z_]+): frozenset\(\s*(?:\{([^}]*)\})?\s*\)/g)) {
    pyTransitions[m[1].toLowerCase()] = [...(m[2] ?? '').matchAll(/OrderStatus\.([A-Z_]+)/g)].map((x) =>
      x[1].toLowerCase(),
    );
  }
  assert.deepEqual(Object.keys(pyTransitions).sort(), [...ORDER_STATUSES].sort(), 'statuses differ');
  for (const status of ORDER_STATUSES) {
    assert.deepEqual(nextStatuses(status).sort(), [...(pyTransitions[status] ?? [])].sort(), status);
  }

  // The web Cancel button shows on open orders only (OrderCard.tsx + isClosed), but
  // the server still refuses some of those (a pending order can't be cancelled).
  const web = read('frontend/carabao-app/util/api/statuses.ts');
  const closed = /export const CLOSED_ORDER_STATUSES: readonly OrderStatus\[\] = \[([^\]]*)\]/.exec(web)?.[1] ?? '';
  const closedStatuses = [...closed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(
    read('frontend/carabao-app/app/(site)/(merchant)/merchant/components/OrderCard.tsx').includes(
      'const isOpenOrder = !isClosed(order.status);',
    ),
    'web cancel gating differs',
  );
  for (const status of ORDER_STATUSES) {
    const webOffersCancel = !closedStatuses.includes(status);
    assert.equal(canCancel(status), webOffersCancel && pyTransitions[status].includes('cancelled'), status);
  }
});

test('S4 filter chips = web OrdersTab.tsx, and orderFilter/orderCounts use them', () => {
  const web = read('frontend/carabao-app/app/(site)/(merchant)/merchant/components/OrdersTab.tsx');
  const chips = /const ORDER_FILTERS = \[([^\]]*)\] as const;/.exec(web)?.[1] ?? '';
  assert.deepEqual([...ORDER_FILTERS], [...chips.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(
    web.includes('orders.filter((o) => activeFilter === "all" || o.status === activeFilter)'),
    'web filter differs',
  );

  const orders = [
    { status: 'processing' },
    { status: 'processing' },
    { status: 'shipped' },
    { status: 'payment_mismatch' },
  ] as const;
  assert.equal(orderFilter(orders, 'all').length, orders.length);
  assert.equal(orderFilter(orders, 'processing').length, 2);
  assert.equal(orderFilter(orders, 'delivered').length, 0);
  // A copy, so screens cannot mutate the context list.
  assert.notEqual(orderFilter(orders, 'all'), orders);
  assert.deepEqual(orderCounts(orders), {
    all: 4,
    processing: 2,
    shipped: 1,
    out_for_delivery: 0,
    delivered: 0,
    cancelled: 0,
  });
});

test('S5 question tag and closed text = web merchant chats page', async () => {
  const { chatTitle } = await import('./orderChat.ts');
  const web = read('frontend/carabao-app/app/(site)/(merchant)/merchant/(shell)/chats/page.tsx');
  const tag = /const INQUIRY_TAG = "([^"]+)";/.exec(web)?.[1] ?? '';
  assert.ok(tag.length > 0, 'INQUIRY_TAG not found in the web chats page');
  // The chat screen's header for a question is that tag (orderChat.chatTitle), so the two
  // apps name a question the same way.
  assert.equal(chatTitle(undefined, { kind: 'inquiry', conversationId: 1 }), tag);
  // A question closes with the shop, not 7 days after a delivery: the web says so too.
  assert.ok(
    web.includes('Your shop is not taking messages right now, so this chat is read-only.'),
    'the closed text for a question differs',
  );
});

test('S5 Chats count = web useMerchantChats: chats + inquiries, one per unread row', () => {
  const hook = read('frontend/carabao-app/app/(site)/(merchant)/merchant/hooks/useMerchantChats.ts');
  // badges.unreadChatCount adds the same two sums, so the tab badge matches the web sidebar.
  assert.ok(
    hook.includes('chats.reduce((sum, c) => sum + (c.unread > 0 ? 1 : 0), 0)'),
    'the order chat count differs',
  );
  assert.ok(
    hook.includes('inquiries.reduce((sum, c) => sum + (c.unread > 0 ? 1 : 0), 0)'),
    'the question count differs',
  );
});

test('S13 PSGC source and NCR label = web util/psgc.ts and util/serviceArea.ts', async () => {
  const { PSGC_BASE, NCR_CODE, provinceForRegion } = await import('./psgc.ts');
  const web = read('frontend/carabao-app/util/psgc.ts');
  // The same API, asked the same way, so both apps show the same names.
  const base = /const BASE = '([^']+)';/.exec(web)?.[1] ?? '';
  assert.ok(base.length > 0, 'BASE not found in frontend/carabao-app/util/psgc.ts');
  assert.equal(PSGC_BASE, base);

  // NCR has no provinces, so its province shows and saves as "Metro Manila" (plan §2.2).
  const webArea = read('frontend/carabao-app/util/serviceArea.ts');
  const webLabel = /export const NCR_PROVINCE = '([^']+)';/.exec(webArea)?.[1] ?? '';
  assert.ok(webLabel.length > 0, 'NCR_PROVINCE not found in frontend/carabao-app/util/serviceArea.ts');
  const { NCR_PROVINCE } = await import('./serviceArea.ts');
  assert.equal(NCR_PROVINCE, webLabel);
  assert.equal(provinceForRegion(NCR_CODE, 'National Capital Region'), webLabel);
  // The web's own NCR code, and its city source for NCR (the region has no provinces).
  const webSelects = read('frontend/carabao-app/components/LocationSelects/LocationSelects.tsx');
  assert.ok(webSelects.includes("const NCR_CODE = '1300000000';"), 'the web NCR code differs');
  assert.equal(NCR_CODE, '1300000000');
  assert.ok(webSelects.includes('fetchCitiesByRegion'), 'the web NCR city source differs');
});

test('S14 shop page limits, slug rules and image parts = backend shopPage.py = web input-limits.ts', async () => {
  const {
    SHOP_DESCRIPTION_MAX, SHOP_SLUG_MAX, SHOP_SLUG_MIN, SHOP_SLUG_PATTERN, SHOP_TITLE_MAX, slugProblem,
  } = await import('./shopPage.ts');

  // The screen and its tests take the field rules from the backend schema.
  const schema = read('backend/app/schemas/shopPage.py');
  assert.match(schema, new RegExp(`^MAX_TITLE = ${SHOP_TITLE_MAX}$`, 'm'));
  assert.match(schema, new RegExp(`^MAX_DESCRIPTION = ${SHOP_DESCRIPTION_MAX}$`, 'm'));
  assert.ok(
    schema.includes(`MIN_SLUG, MAX_SLUG = ${SHOP_SLUG_MIN}, ${SHOP_SLUG_MAX}`),
    'the backend slug lengths differ',
  );
  // The same expression, in Python's raw-string syntax.
  const pattern = /^SLUG_PATTERN = r"(.+)"$/m.exec(schema)?.[1] ?? '';
  assert.ok(pattern.length > 0, 'SLUG_PATTERN not found in backend/app/schemas/shopPage.py');
  assert.equal(pattern, SHOP_SLUG_PATTERN.source);

  // /farms/<number> is a farm id, so a slug of only digits is refused: the screen says the
  // backend's words.
  const digitText = /raise ValueError\("([^"]+)"\)/.exec(schema)?.[1] ?? '';
  assert.ok(digitText.length > 0, 'the digits validator is missing from shopPage.py');
  assert.equal(slugProblem('12345'), digitText);

  // The web Shop tab's maxLength, so both apps stop at the same count.
  const webLimits = read('frontend/carabao-app/lib/input-limits.ts');
  assert.ok(
    webLimits.includes(`export const SHOP_TITLE_MAX = ${SHOP_TITLE_MAX};`),
    'the web title limit differs',
  );
  assert.ok(
    webLimits.includes(`export const SHOP_DESCRIPTION_MAX = ${SHOP_DESCRIPTION_MAX};`),
    'the web description limit differs',
  );

  // Each image goes up as its route's part: POST .../shoppage/logo and .../shoppage/banner.
  const routes = read('backend/app/api/routes/merchant_shop.py');
  for (const part of ['logo', 'banner']) {
    assert.ok(
      routes.includes(`${part}: UploadFile = File(...)`),
      `the backend's ${part} part differs`,
    );
  }
  const client = read('mobile/CarabaoMerchantMobile/src/lib/api.ts');
  assert.ok(client.includes("form.append('logo', file"), 'the logo part name differs');
  assert.ok(client.includes("form.append('banner', file"), 'the banner part name differs');
  // The draft-only updates and the three state calls, all under /merchants/me/shoppage.
  for (const path of [
    "'/merchants/me/shoppage'",
    "'/merchants/me/shoppage/publish'",
    "'/merchants/me/shoppage/unpublish'",
    "'/merchants/me/shoppage/discard'",
  ]) {
    assert.ok(client.includes(path), `api.ts is missing ${path}`);
  }
});

test('S15 voucher code and percent cap = backend vouchers.py = web lib/vouchers.ts', async () => {
  const { CODE_MESSAGE, CODE_PATTERN, MAX_PERCENT, deleteConfirmText } = await import('./vouchers.ts');

  // The service's expression, which runs on the code after normalize_code upper-cases it.
  const service = read('backend/app/services/vouchers.py');
  const servicePattern = /^CODE_PATTERN = re\.compile\(r"(.+)"\)$/m.exec(service)?.[1] ?? '';
  assert.ok(servicePattern.length > 0, 'CODE_PATTERN not found in backend/app/services/vouchers.py');
  assert.equal(CODE_PATTERN.source, servicePattern);
  assert.match(service, new RegExp(`^MAX_PERCENT = ${MAX_PERCENT}$`, 'm'));
  // The schema takes either case and spaces around it, at the same 3-32 length.
  assert.match(
    read('backend/app/schemas/voucher.py'),
    /^CODE_FIELD_PATTERN = r"\^\\s\*\[A-Za-z0-9\]\[A-Za-z0-9-\]\{2,31\}\\s\*\$"$/m,
  );

  // The web merchant form's own copies, in step with this app's.
  const web = read('frontend/carabao-app/lib/vouchers.ts');
  assert.ok(web.includes(`export const CODE_PATTERN = ${CODE_PATTERN.toString()};`), 'the web code pattern differs');
  assert.ok(web.includes(`export const MAX_PERCENT = ${MAX_PERCENT};`), 'the web percent cap differs');
  assert.ok(web.includes(CODE_MESSAGE), 'the web code message differs');

  // The confirm is the web's merchantConfirm.deleteVoucher.
  assert.match(read('frontend/carabao-app/lib/i18n/strings/en.ts'), /deleteVoucher: 'Delete voucher \{code\}\?'/);
  assert.equal(deleteConfirmText('SAVE10'), 'Delete voucher SAVE10?');
});

test('S15 voucher calls and screen are wired like the web Vouchers tab', () => {
  const client = read('mobile/CarabaoMerchantMobile/src/lib/api.ts');
  // The list, create, edit (on/off) and delete the web page calls.
  for (const call of [
    "'/merchants/me/vouchers'",
    '`/merchants/me/vouchers/${voucherId}`',
    'createVoucher',
    'updateVoucher',
    'deleteVoucher',
  ]) {
    assert.ok(client.includes(call), `api.ts is missing ${call}`);
  }
  // app/vouchers.tsx renders the screen rather than the S3 placeholder.
  assert.match(
    read('mobile/CarabaoMerchantMobile/app/vouchers.tsx'),
    /export \{ default \} from '\.\.\/src\/screens\/VouchersScreen';/,
  );
});


