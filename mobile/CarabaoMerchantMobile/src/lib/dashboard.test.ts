/// <reference types="node" />
// Run with `npm test`. CF-0125, S19 (web M/(shell)/page.tsx, VerificationBanner, MerchantWelcome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertCounts, attentionRows, bannerLine, barHeights, cancelRate, deltaLabel, deltaPercent, greeting, merchantWelcome,
  openTotal, peso, recentOrders, salesWindows, statCards, unmetSearches, verificationBanner, type MerchantPerformance,
} from './dashboard.ts';

const perf: MerchantPerformance = {
  merchant_id: 1, merchant_name: 'Dela Cruz', rating: 4.5, rating_count: 2, total_products: 7, total_orders: 30,
  active_orders: 3, delivered_orders: 24, cancelled_orders: 3, total_revenue: 125000, last_30_days_orders: 9,
  last_30_days_revenue: 15400.4,
};

test('money in whole pesos', () => {
  assert.equal(peso(15400.4), '₱15,400');
  assert.equal(peso(Number.NaN), '₱0');
});

test('cancel rate over finished orders only', () => {
  assert.equal(cancelRate(perf), 11);
  assert.equal(cancelRate({ delivered_orders: 0, cancelled_orders: 0 }), null);
});

test('alert counts', () => {
  assert.deepEqual(alertCounts({ low_stock: [1, 2], expiring_soon: [3], expired: [] }), { low: 2, expiring: 1, expired: 0, total: 3 });
  assert.deepEqual(alertCounts(null), { low: 0, expiring: 0, expired: 0, total: 0 });
});

test('unmet searches: only no-result ones, most first, capped', () => {
  const d = {
    province: 'Benguet', days: 30, most_ordered: [], most_searched_luzon: [],
    most_searched: [
      { query: 'kale', searches: 9, no_result_searches: 0 },
      { query: 'strawberry', searches: 12, no_result_searches: 5 },
      { query: 'ube', searches: 7, no_result_searches: 7 },
    ],
  };
  assert.deepEqual(unmetSearches(d).map((t) => t.query), ['ube', 'strawberry']);
  assert.deepEqual(unmetSearches(d, 1).map((t) => t.query), ['ube']);
  assert.deepEqual(unmetSearches(null), []);
});

test('verification banner: the web title, then currentStep text and action', () => {
  assert.equal(verificationBanner('verified'), null);
  assert.equal(verificationBanner(undefined), null);
  assert.equal(verificationBanner(null), null);
  const setup = verificationBanner('setup')!;
  assert.equal(setup.title, "Your shop isn't live yet.");
  assert.match(setup.text, /business information/);
  assert.deepEqual(setup.action, { label: 'Add business information', path: '/onboarding?step=business' });
  assert.equal(verificationBanner('under_review')!.action, undefined);
  assert.equal(verificationBanner('needs_changes')!.action!.label, 'Review and resubmit');
  assert.match(bannerLine(verificationBanner('suspended')!), /^Your shop isn't live yet\. Your shop is suspended/);
  assert.equal(bannerLine(verificationBanner('odd')!), "Your shop isn't live yet.");
});

test('greeting uses the first name only', () => {
  assert.equal(greeting('Juan Dela Cruz'), 'Welcome back, Juan. This is how your shop is doing.');
  assert.equal(greeting(''), 'This is how your shop is doing.');
  assert.equal(greeting(null), 'This is how your shop is doing.');
});

const day = (i: number, revenue: number, orders: number) => ({ date: `2026-09-${String(i).padStart(2, '0')}`, revenue, orders });

test('sales windows: last 30 against the 30 before, only with 60 days', () => {
  const daily = [...Array.from({ length: 30 }, (_, i) => day(i, 10, 1)), ...Array.from({ length: 30 }, (_, i) => day(i, 20, 2))];
  const w = salesWindows(daily);
  assert.equal(w.last30.length, 30);
  assert.equal(w.rev30, 600);
  assert.equal(w.revPrev30, 300);
  assert.equal(w.orders30, 60);
  assert.equal(w.ordersPrev30, 30);
  assert.ok(w.hasPrevious);
  const short = salesWindows(daily.slice(-40));
  assert.equal(short.revPrev30, 0);
  assert.equal(short.hasPrevious, false);
  assert.equal(salesWindows([]).rev30, 0);
});

test('delta: whole percent, none without a previous period', () => {
  assert.equal(deltaPercent(600, 300), 100);
  assert.equal(deltaPercent(150, 200), -25);
  assert.equal(deltaPercent(5, 0), null);
  assert.equal(deltaLabel(600, 300), '↑ 100%');
  assert.equal(deltaLabel(150, 200), '↓ 25%');
  assert.equal(deltaLabel(1, 0), '');
});

test('bar heights are percent of the tallest; all zero stays flat', () => {
  assert.deepEqual(barHeights([0, 5, 10]), [0, 50, 100]);
  assert.deepEqual(barHeights([0, 10], 12), [12, 100]);
  assert.deepEqual(barHeights([0, 0]), [0, 0]);
  assert.deepEqual(barHeights([]), []);
});

const order = (id: number, status: string, ordered_at: string) =>
  ({ id, status, ordered_at, shipped: false, shipment_id: null }) as never;

test('stat cards: web order, live counts from the shared orders and produce', () => {
  const p: MerchantPerformance = { ...perf, rating: 4.25, rating_count: 1, total_products: 9, total_orders: 4, active_orders: 99, delivered_orders: 2 };
  const cards = statCards({
    performance: p, sales: null,
    orders: [order(1, 'processing', 'a'), order(2, 'delivered', 'b')],
    produce: [{ stock_quantity: 0 }, { stock_quantity: 3 }],
    lowStock: 1, available: { net_amount: 500, transaction_count: 1 },
  });
  assert.deepEqual(cards.map((c) => c.key), ['revenue', 'orders', 'active', 'payout', 'produce', 'rating']);
  const by = Object.fromEntries(cards.map((c) => [c.key, c]));
  assert.equal(by.active.value, '1');
  assert.equal(by.active.sub, '2 delivered (50%)');
  assert.equal(by.active.route, '/shipments', 'a paid order waits for a route');
  assert.ok(by.active.alert);
  assert.equal(by.produce.value, '2');
  assert.equal(by.produce.sub, '1 low stock · 1 out of stock');
  assert.equal(by.payout.sub, '1 paid order, after fees');
  assert.equal(by.rating.value, '4.3 / 5');
  assert.equal(by.rating.sub, '1 review →');
  // Before the orders load, the web uses performance.
  const early = statCards({ performance: p, sales: null, orders: null, produce: null, lowStock: 0, available: null });
  assert.equal(early.find((c) => c.key === 'active')!.value, '99');
  assert.equal(early.find((c) => c.key === 'payout')!.value, '—');
});

test('needs your attention: web rows, mobile routes', () => {
  const rows = attentionRows({
    orders: [order(1, 'processing', 'a'), order(2, 'shipped', 'b'), order(3, 'out_for_delivery', 'c')],
    produce: [{ stock_quantity: 0 }],
    alerts: { low_stock_threshold: 3, low_stock: [1], expiring_soon: [1], expired: [1] },
    payouts: [{ status: 'failed' }, { status: 'released' }],
    shopPage: { is_published: true },
    merchant: { lat: null, lng: null, paused_until: '2026-11-30' },
    today: '2026-11-24',
  });
  assert.deepEqual(rows.map((r) => r.key), ['ship', 'delivery', 'low', 'out', 'expiry', 'payout', 'paused', 'setup']);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.ship.count, 1);
  assert.equal(by.delivery.count, 2);
  assert.equal(by.low.action, 'At or below 3 left');
  assert.equal(by.expiry.count, 2);
  assert.equal(by.payout.count, 1);
  assert.equal(by.paused.count, 1);
  assert.match(by.paused.action, /^Orders are paused through Nov 30/);
  assert.equal(by.paused.route, '/settings');
  assert.equal(by.setup.count, 1);
  assert.equal(by.setup.route, '/settings');
  assert.equal(by.setup.action, 'Set your farm pickup pin');
  assert.equal(openTotal(rows), 1 + 2 + 1 + 1 + 2 + 1 + 1 + 1);

  const calm = attentionRows({
    orders: [], produce: [], alerts: null, payouts: [{ status: 'released' }, { status: 'failed' }],
    shopPage: null, merchant: null, today: '2026-11-24',
  });
  const c = Object.fromEntries(calm.map((r) => [r.key, r]));
  assert.equal(c.payout.count, 0, 'an older failure that was resent does not count');
  assert.equal(c.paused.action, 'Your store takes orders');
  assert.equal(c.setup.count, 1);
  assert.equal(c.setup.route, '/shop');
  assert.equal(c.setup.action, 'Create your public shop page');
  assert.equal(c.low.action, 'At or below 5 left');
});

test('recent orders: newest six', () => {
  const list = Array.from({ length: 8 }, (_, i) => ({ id: i, ordered_at: `2026-11-0${i + 1}T00:00:00Z` }));
  assert.deepEqual(recentOrders(list).map((o) => o.id), [7, 6, 5, 4, 3, 2]);
});

test('welcome text for an account with no farm, by application status', () => {
  assert.equal(merchantWelcome(null).action!.label, 'Start Registration');
  assert.equal(merchantWelcome('approved').title, 'Welcome to Carabao Merchant Centre!');
  assert.equal(merchantWelcome('submitted').action, undefined);
  assert.equal(merchantWelcome('pending_documents').action!.to, 'onboarding');
  assert.equal(merchantWelcome('clarification').action!.label, 'Update application');
  assert.equal(merchantWelcome('rejected').action!.label, 'Apply again');
  assert.equal(merchantWelcome('suspended').action!.to, 'support');
});
