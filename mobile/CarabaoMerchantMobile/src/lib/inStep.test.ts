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

// ── S17: onboarding (plan §5.12) ──────────────────────────────────────────────

const ONBOARDING_PAGE = 'frontend/carabao-app/app/(site)/(merchant)/merchant/onboarding/page.tsx';
const CONTACT_FIELD = 'frontend/carabao-app/app/(site)/(merchant)/merchant/onboarding/ContactCodeField.tsx';
/** The web writes strings in double quotes and splits long ones with `" +` lines: join them. */
const webText = (path: string) => read(path).replace(/"\s*\+\s*\n\s*"/g, '');
/** The members of a web `new Set<string>([...])` or a backend Literal[...]. */
const quoted = (body: string) => [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const webSet = (web: string, name: string) =>
  quoted(new RegExp(`const ${name} = new Set(?:<string>)?\\(\\[([\\s\\S]*?)\\]\\);`).exec(web)?.[1] ?? '');
const pyLiteral = (py: string, name: string) =>
  quoted(new RegExp(`^${name} = Literal\\[([\\s\\S]*?)\\]`, 'm').exec(py)?.[1] ?? '');
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('S17 steps, seller types and choices = web onboarding page = backend schema', async () => {
  const o = await import('./onboarding.ts');
  const web = webText(ONBOARDING_PAGE);
  assert.ok(web.includes('type StepId = "ops" | "legal";'), 'the web step ids differ');
  for (const s of o.STEPS) {
    assert.ok(
      web.includes(`{ id: "${s.id}", title: "${s.title}", subtitle: "${s.subtitle}" }`),
      `step ${s.id} differs from the web`,
    );
  }
  assert.ok(web.includes('`${stepIndex + 1} / ${STEPS.length}`'), 'the progress pill differs');
  for (const opt of o.SELLER_OPTIONS) {
    assert.ok(web.includes(`{ value: "${opt.value}", label: "${opt.label}" }`), `seller label ${opt.value} differs`);
  }
  for (const opt of o.SUBMIT_MODE_OPTIONS) {
    assert.ok(web.includes(`{ value: "${opt.value}", label: "${opt.label}" }`), `submit mode ${opt.value} differs`);
  }
  for (const [type, r] of Object.entries(o.REGISTRATION)) {
    assert.ok(
      web.includes(`agency: "${r!.agency}"`) && web.includes(`placeholder: "${r!.placeholder}"`)
        && web.includes(`hint: "${r!.hint}"`),
      `registration of ${type} differs`,
    );
  }
  assert.ok(web.includes(JSON.stringify(o.SMALL_PRODUCER_HELP)), 'SMALL_PRODUCER_HELP differs');
  assert.ok(web.includes(JSON.stringify(o.SUBMIT_LATER_HELP)), 'SUBMIT_LATER_HELP differs');
  assert.ok(web.includes(`<h1 className={styles.title}>${o.FORM_TITLE}</h1>`), 'the title differs');
  assert.ok(web.includes(o.FORM_SUBTITLE), 'the subtitle differs');

  const api = read('frontend/carabao-app/util/api/merchants.ts');
  const list = (name: string) =>
    quoted(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(api)?.[1] ?? '');
  assert.deepEqual([...o.SELLER_TYPES], list('SELLER_TYPES'));
  assert.deepEqual([...o.NAME_SUFFIXES], list('NAME_SUFFIXES'));
  assert.deepEqual([...o.GOV_ID_TYPES], list('GOV_ID_TYPES'));

  const py = read('backend/app/schemas/merchant_application.py');
  assert.deepEqual([...o.SELLER_TYPES], pyLiteral(py, 'SellerType'));
  assert.deepEqual([...o.NAME_SUFFIXES], pyLiteral(py, 'NameSuffix'));
  assert.deepEqual([...o.GOV_ID_TYPES], pyLiteral(py, 'GovIdType'));
  assert.deepEqual(o.SUBMIT_MODE_OPTIONS.map((m) => m.value), pyLiteral(py, 'SubmitMode'));

  // The Terms version the web sends with a submit.
  const terms = read('frontend/carabao-app/components/TermsModal/TermsOfServiceContent.tsx');
  assert.ok(terms.includes(`export const TERMS_EFFECTIVE_DATE = "${o.TERMS_VERSION}";`), 'TERMS_VERSION differs');
});

test('S17 field limits = web onboarding page = backend schema', async () => {
  const o = await import('./onboarding.ts');
  const web = webText(ONBOARDING_PAGE);
  assert.ok(web.includes(`const NAME_MAX = ${o.NAME_MAX};`));
  assert.ok(web.includes(`const PERSON_MAX = ${o.PERSON_MAX};`));
  assert.ok(web.includes(`const COMPANY_MAX = ${o.COMPANY_MAX};`));
  assert.ok(web.includes(`merchantName.length < ${o.NAME_MIN}`));
  assert.ok(web.includes(`.slice(0, ${o.REGISTRATION_MAX})`) && web.includes(`max={${o.REGISTRATION_MAX}}`));
  assert.ok(web.includes(`max={${o.TIN_MAX}}`), 'TIN max differs');
  assert.ok(web.includes(`maxLength={${o.RSBSA_MAX}}`), 'RSBSA max differs');
  assert.ok(web.includes(`maxLength={${o.LOCAL_PHONE_MAX}}`), 'phone max differs');
  assert.ok(web.includes(`const TIN_DIGITS = ${o.TIN_DIGITS.toString()};`), 'TIN pattern differs');
  assert.ok(web.includes(`const EMAIL_PATTERN = ${o.EMAIL_PATTERN.toString()};`), 'email pattern differs');
  assert.ok(web.includes('available_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],'), 'the default days differ');
  assert.deepEqual(o.INITIAL_FORM.available_days, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  assert.ok(web.includes(`gov_id_type: "${o.INITIAL_FORM.gov_id_type}",`), 'the default ID differs');

  const py = read('backend/app/schemas/merchant_application.py');
  assert.match(py, new RegExp(`^MERCHANT_NAME_MAX = ${o.NAME_MAX}$`, 'm'));
  assert.match(py, new RegExp(`^PERSON_NAME_MAX = ${o.PERSON_MAX}$`, 'm'));
  assert.match(py, new RegExp(`^COMPANY_NAME_MAX = ${o.COMPANY_MAX}$`, 'm'));
  assert.match(py, new RegExp(`min_length=${o.NAME_MIN}, max_length=MERCHANT_NAME_MAX`));
});

test('S17 messages and words = web onboarding page and ContactCodeField', async () => {
  const o = await import('./onboarding.ts');
  const web = webText(ONBOARDING_PAGE);
  for (const [key, message] of Object.entries(o.MESSAGES)) {
    if (typeof message !== 'string') continue;
    assert.ok(web.includes(JSON.stringify(message)), `message ${key} differs from the web`);
  }
  assert.ok(web.includes('`${registration?.agency ?? "Registration"} number is required.`'));
  assert.equal(o.MESSAGES.registration('DTI'), 'DTI number is required.');
  for (const label of Object.values(o.DOCUMENT_LABELS)) {
    assert.ok(web.includes(`, "${label}")`), `document label ${label} differs`);
  }
  assert.ok(web.includes(JSON.stringify(o.EMAIL_SEND_PROBLEM)));
  assert.ok(web.includes(JSON.stringify(o.PHONE_SEND_PROBLEM)));
  assert.ok(web.includes(JSON.stringify(o.CONTACT_WORDS.accountEmail)));
  assert.ok(web.includes(JSON.stringify(o.CONTACT_WORDS.accountPhone)));
  for (const [key, word] of Object.entries(o.OPS_WORDS)) {
    assert.ok(
      web.includes(`"${word}"`) || new RegExp(`>\\s*${escapeRe(word)}\\s*<`).test(web),
      `step 1 word ${key} differs from the web`,
    );
  }
  // The address words are the web onboarding's (src/lib/pinLocation.ts ADDRESS_MESSAGES).
  const { ADDRESS_MESSAGES } = await import('./pinLocation.ts');
  for (const message of Object.values(ADDRESS_MESSAGES)) {
    assert.ok(web.includes(JSON.stringify(message)), `address message ${message} differs`);
  }

  const field = read(CONTACT_FIELD);
  const w = o.CONTACT_WORDS;
  for (const word of [w.sendCode, w.sending, w.verify, w.verifying, w.sendError, w.verifyError, w.resend]) {
    assert.ok(field.includes(`"${word}"`), `ContactCodeField word ${word} differs`);
  }
  assert.ok(field.includes('`Resend in ${formatCountdown(cooldown)}`'));
  assert.equal(w.resendIn('0:45'), 'Resend in 0:45');
  assert.ok(field.includes('Enter the 6-digit code sent to your {channel}.'));
  assert.equal(w.hint('email'), 'Enter the 6-digit code sent to your email.');
  assert.ok(field.includes('`6-digit code sent to your ${channel}`'));
  assert.ok(field.includes('`Your ${channel} is verified.`'));
  assert.ok(field.includes('maxLength={6}'));
});

test('S17 server error routing = web OPS_FIELDS, SERVER_FIELD_ALIASES, SHOWN_FIELDS', async () => {
  const o = await import('./onboarding.ts');
  const web = webText(ONBOARDING_PAGE);
  assert.deepEqual([...o.OPS_FIELDS].sort(), webSet(web, 'OPS_FIELDS').sort());
  assert.deepEqual([...o.SHOWN_FIELDS].sort(), webSet(web, 'SHOWN_FIELDS').sort());
  assert.deepEqual([...o.PREFILL_STATUSES].sort(), webSet(web, 'PREFILL_STATUSES').sort());
  const aliases = /const SERVER_FIELD_ALIASES: Record<string, FieldKey> = \{([\s\S]*?)\};/.exec(web)?.[1] ?? '';
  const webAliases = Object.fromEntries([...aliases.matchAll(/(\w+): "(\w+)"/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual({ ...o.SERVER_FIELD_ALIASES }, webAliases);
});

test('S17 resend cooldown = web lib/otp-cooldown.ts and hooks/useResendCooldown.ts = backend otp.py', async () => {
  const { OTP_RESEND_SECONDS, ANY_TARGET } = await import('./resendCooldown.ts');
  const shared = read('frontend/carabao-app/lib/otp-cooldown.ts');
  assert.ok(shared.includes(`export const OTP_RESEND_SECONDS = ${OTP_RESEND_SECONDS};`));
  assert.match(read('backend/app/services/otp.py'), new RegExp(`^OTP_RESEND_COOLDOWN_SECONDS = ${OTP_RESEND_SECONDS}$`, 'm'));
  const hook = read('frontend/carabao-app/hooks/useResendCooldown.ts');
  assert.ok(hook.includes('const ANY = "\\u0000any";'), 'the any-target key differs');
  assert.equal(ANY_TARGET, '\u0000any');
  assert.ok(hook.includes('start(wait > OTP_RESEND_SECONDS ? ANY : target, wait);'), 'the hourly rule differs');
  // The words the wait is read from (backend reserve_send) still fit the pattern.
  assert.ok(read('backend/app/services/otp.py').includes('f"Please wait {wait} seconds before requesting another code."'));
});

test('S17 serviceArea.ts is the web util/serviceArea.ts; api.ts has the onboarding calls', () => {
  const web = read('frontend/carabao-app/util/serviceArea.ts');
  const copy = read('mobile/CarabaoMerchantMobile/src/lib/serviceArea.ts');
  const body = copy.slice(copy.indexOf('// Carabao serves'));
  assert.equal(body.trimEnd(), web.trimEnd());
  const client = read('mobile/CarabaoMerchantMobile/src/lib/api.ts');
  for (const call of [
    "'/merchant-applications/me'", "'/sms/otp/send'", "'/sms/otp/verify'", "'/email/otp/send'", "'/email/otp/verify'",
  ]) {
    assert.ok(client.includes(call), `api.ts is missing ${call}`);
  }
  // The web sends the same bodies (util/api/sms.ts).
  const sms = read('frontend/carabao-app/util/api/sms.ts');
  assert.ok(sms.includes("'/email/otp/send', { email }") && sms.includes('{ email, otp }'));
  assert.ok(sms.includes("'/sms/otp/send', { number }") && sms.includes('{ number, otp }'));
});

// ── S18: documents, submit, status (plan §5.12) ───────────────────────────────

test('S18 step 2 words = web onboarding page', async () => {
  const o = await import('./onboarding.ts');
  const web = webText(ONBOARDING_PAGE);
  for (const [key, word] of Object.entries(o.LEGAL_WORDS)) {
    assert.ok(
      web.includes(`"${word}"`) || new RegExp(`>\\s*${escapeRe(word)}\\s*<`).test(web),
      `step 2 word ${key} differs from the web`,
    );
  }
  for (const opt of [...o.VAT_OPTIONS, ...o.YES_NO_OPTIONS]) {
    assert.ok(web.includes(`{ value: ${JSON.stringify(opt.value)}, label: "${opt.label}" }`), `option ${opt.label} differs`);
  }
  assert.ok(web.includes('Upload a clear photo or a PDF scan of your Philippine RSBSA document and of one valid government ID'));
  assert.ok(web.includes('" of your authorized representative"'));
  assert.ok(web.includes('isSubmitting ? "Saving…" : later ? "Save and finish later" : "Submit"'), 'the submit button differs');
  assert.ok(web.includes('.get("step") === "business"'), 'the business-step link differs');
});

test('S18 submit = web submitMyMerchantOnboarding; body limit = backend body_limit.py', () => {
  const web = read('frontend/carabao-app/util/api/merchants.ts');
  const client = read('mobile/CarabaoMerchantMobile/src/lib/api.ts');
  assert.ok(web.includes("apiClient.post<MerchantApplication>('/merchant-onboarding/me', formData)"));
  assert.ok(client.includes("'/merchant-onboarding/me'"));
  assert.ok(web.includes("formData.append('payload', JSON.stringify(payload));"));
  assert.ok(client.includes("form.append('payload', JSON.stringify(payload));"));
  for (const part of ['rsbsa_file', 'gov_id_file', 'bir_cert_file', 'selfie_file']) {
    assert.ok(web.includes(`formData.append('${part}'`), `the web has no ${part}`);
    assert.ok(client.includes(`['${part}', documents.`), `api.ts has no ${part}`);
  }
  const limit = read('backend/app/core/body_limit.py');
  assert.ok(limit.includes('return f"Request body must be under {limit // MB} MB"'), 'the 413 words differ');
  // The 429 the screen shows comes from the backend's limiter.
  assert.match(read('backend/app/services/rate_limit.py'), /onboarding_submit/);
});

test('S18 status words = web verification.ts, success card, SetupChecklist; status map = backend', async () => {
  const a = await import('./application.ts');
  const verification = read('frontend/carabao-app/app/(site)/(merchant)/merchant/lib/verification.ts');
  for (const status of ['setup', 'under_review', 'needs_changes', 'suspended', 'verified'] as const) {
    const step = a.currentStep(status);
    assert.ok(verification.includes(`"${step.text}"`) || step.text === a.APPROVED_PUBLISH, `step text ${status} differs`);
    if (step.action) assert.ok(verification.includes(`label: "${step.action.label}"`), `action ${status} differs`);
  }
  assert.ok(verification.includes(`export const APPROVED_PUBLISH = "${a.APPROVED_PUBLISH}";`));
  assert.ok(verification.includes('export const BUSINESS_STEP_PATH = `${P.onboarding}?step=business`;'));

  const web = webText(ONBOARDING_PAGE);
  const w = a.APPLICATION_WORDS;
  assert.ok(web.includes(`"${w.savedTitle}" : "${w.submittedTitle}"`), 'the success titles differ');
  assert.ok(web.includes(`"${w.savedText}"`), 'the saved text differs');
  assert.ok(web.includes(`"${w.submittedText}"`), 'the submitted text differs');
  assert.ok(web.includes('>Go to Merchant Centre</button>'));

  const checklist = read('frontend/carabao-app/app/(site)/(merchant)/merchant/components/SetupChecklist.tsx');
  assert.ok(checklist.includes(`"${w.changesRequested}"`) && checklist.includes(`"${w.approved}"`));
  assert.ok(checklist.includes(`"${a.SUSPENDED_TITLE}"`));
  assert.ok(checklist.includes('Carabao: {item.note}') && w.notePrefix === 'Carabao: ');
  assert.ok(checklist.includes('note: status === "needs_changes" ? application?.admin_note : null,'));
  const banner = read('frontend/carabao-app/app/(site)/(merchant)/merchant/components/VerificationBanner.tsx');
  assert.ok(banner.includes('Your shop isn&apos;t live yet.') && w.notLive === "Your shop isn't live yet.");

  const py = read('backend/app/models/statuses.py');
  const map = /APPLICATION_TO_VERIFICATION[^{]*\{([\s\S]*?)\}/.exec(py)?.[1] ?? '';
  const pairs = Object.fromEntries(
    [...map.matchAll(/"(\w+)":\s*MerchantVerificationStatus\.(\w+)/g)].map((m) => [m[1], m[2]!.toLowerCase()]),
  );
  assert.deepEqual(pairs, a.APPLICATION_TO_VERIFICATION);
});

test('S18 /onboarding and /application are open to a signed-in account with or without a farm', () => {
  const layout = read('mobile/CarabaoMerchantMobile/app/_layout.tsx');
  const group = /guard=\{status === 'allowed' \|\| status === 'forbidden'\}[\s\S]*?<\/Stack\.Protected>/.exec(layout)?.[0] ?? '';
  assert.ok(group.includes('name="onboarding"') && group.includes('name="application"'), 'the onboarding group is missing');
  assert.equal(layout.match(/name="onboarding"/g)?.length, 1);
  assert.equal(layout.match(/name="application"/g)?.length, 1);
});

test('S19 Home = web SetupChecklist, dashboard page, VerificationBanner, MerchantWelcome', async () => {
  const c = await import('./setupChecklist.ts');
  const d = await import('./dashboard.ts');
  const M = 'frontend/carabao-app/app/(site)/(merchant)/merchant/';
  const checklist = read(`${M}components/SetupChecklist.tsx`);
  const { title, sub, ...words } = c.CHECKLIST_WORDS;
  assert.ok(checklist.includes(`${title}\n`), 'the checklist title differs');
  assert.ok(checklist.includes(`"${sub}"`), 'the checklist sub differs');
  for (const [k, w] of Object.entries(words)) assert.ok(checklist.includes(`"${w}"`), `checklist word ${k} differs`);
  // Same items in the same order.
  const webKeys = [...checklist.matchAll(/key: "(\w+)"/g)].map((m) => m[1]);
  const mobile = c.setupChecklist({ status: 'setup', shopPage: null, productCount: 0, hasPayout: false })!.items.map((i) => i.key);
  // The approval item is built first on the web and placed after the documents item.
  assert.deepEqual(webKeys.filter((k) => k !== 'approved'), mobile.filter((k) => k !== 'approved'));
  assert.match(checklist, /key: "documents"[\s\S]*?\n {4}approval,\n[\s\S]*?key: "publish"/);
  assert.equal(mobile.indexOf('approved'), mobile.indexOf('documents') + 1);
  assert.ok(checklist.includes('if (shopPage?.is_published) return null;'));

  const page = read(`${M}(shell)/page.tsx`);
  const rows = d.attentionRows({ orders: [], produce: [], alerts: null, payouts: [], shopPage: null, merchant: null });
  assert.deepEqual(rows.map((r) => r.key), [...page.matchAll(/\{ key: "(\w+)", icon:/g)].map((m) => m[1]));
  for (const r of rows) assert.ok(page.includes(`label: "${r.label}"`), `attention label ${r.key} differs`);
  for (const a of ['Paid orders to put on a route', 'Set your farm pickup pin', 'Publish your shop page', 'Create your public shop page'])
    assert.ok(page.includes(`"${a}"`), `attention action "${a}" differs`);
  const w = d.DASHBOARD_WORDS;
  for (const k of ['attentionTitle', 'viewOrders', 'addProduce', 'recentTitle', 'allOrders', 'ordersTitle', 'eyebrow'] as const)
    assert.ok(page.includes(`>${w[k]}<`) || page.includes(` ${w[k]}\n`) || page.includes(`${w[k]} <`), `${k} differs`);
  assert.ok(page.includes('"Nothing waiting"') && page.includes('You&apos;re all caught up.'));
  assert.ok(page.includes('This is how your shop is doing.') && page.includes(String.raw`Welcome back, ${'$'}{userName.split(/\s+/)[0]}. `));
  for (const label of ['Revenue, last 30 days', 'Orders, last 30 days', 'Active orders', 'Ready to cash out', 'Produce listed'])
    assert.ok(page.includes(`label="${label}"`), `stat ${label} differs`);
  assert.ok(page.includes('.slice(0, 6)'), 'recent orders count differs');

  // JSX text wraps over lines: compare with single spaces.
  const welcome = read(`${M}MerchantWelcome.tsx`).replace(/\s+/g, ' ');
  for (const status of [null, 'submitted', 'pending_documents', 'clarification', 'rejected', 'suspended']) {
    const v = d.merchantWelcome(status);
    assert.ok(welcome.includes(v.title), `welcome title ${status} differs`);
    assert.ok(welcome.includes(v.body), `welcome text ${status} differs`);
    if (v.action) assert.ok(welcome.includes(v.action.label), `welcome action ${status} differs`);
  }
});
