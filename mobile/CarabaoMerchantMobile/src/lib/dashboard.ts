// CF-0125: the merchant dashboard (web merchant shell home): performance numbers
// (GET /merchants/me/performance), stock alerts, and demand in the merchant's
// province (GET /merchants/me/demand). Pure, for `npm test`.
// S19 (plan §5.1): the web home's rules (M/(shell)/page.tsx: stat cards, "Needs your
// attention", the 30-day bars, recent orders), the banner (M/components/VerificationBanner.tsx
// with M/lib/verification.ts currentStep, copied in application.ts) and the welcome text for an
// account with no farm (M/MerchantWelcome.tsx). inStep.test.ts reads those web files.
import type { ApiMerchantOrder, ApiMyMerchant, ApiProduce, ApiShopPage, MerchantPayoutBatch, MerchantSales } from './api.ts';
import { APPLICATION_WORDS, currentStep, type VerificationStatus } from './application.ts';
import { ACTIVE_ORDER_STATUSES, readyToShipCount } from './badges.ts';
import { formatPeso } from './format.ts';
import { activePause, shortDay } from './storePause.ts';

export type MerchantPerformance = {
  merchant_id: number;
  merchant_name: string;
  /** setup | under_review | needs_changes | verified | suspended. Only verified sells. */
  verification_status?: string;
  rating?: number | null;
  rating_count: number;
  total_products: number;
  total_orders: number;
  active_orders: number;
  delivered_orders: number;
  cancelled_orders: number;
  total_revenue: number;
  last_order_at?: string | null;
  last_30_days_orders: number;
  last_30_days_revenue: number;
};

const KNOWN_STATUSES: readonly string[] = ['setup', 'under_review', 'needs_changes', 'suspended'];

export type VerificationBanner = {
  title: string;
  text: string;
  action?: { label: string; path: string };
};

/**
 * The "not live yet" banner while Carabao has not verified the farm, or null (web
 * VerificationBanner: the title, then currentStep's text and action). The merchant screens
 * open for any merchant row; the server refuses selling.
 */
export function verificationBanner(status: string | null | undefined): VerificationBanner | null {
  if (!status || status === 'verified') return null;
  if (!KNOWN_STATUSES.includes(status)) return { title: APPLICATION_WORDS.notLive, text: '' };
  return { title: APPLICATION_WORDS.notLive, ...currentStep(status as VerificationStatus) };
}

/** The banner as one line, for a screen without the action button (More). */
export const bannerLine = (b: VerificationBanner): string => (b.text ? `${b.title} ${b.text}` : b.title);

export type DemandTerm = { query: string; searches: number; no_result_searches: number };
export type DemandInsight = {
  province: string;
  days: number;
  most_ordered: { name: string; orders: number; quantity: number }[];
  most_searched: DemandTerm[];
  most_searched_luzon: DemandTerm[];
};

export type AlertsLike = { low_stock: unknown[]; expiring_soon: unknown[]; expired: unknown[] };

export const peso = (n: number): string => `₱${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-PH')}`;

/** Share of finished orders that were cancelled (0-100, whole), or null with no finished orders. */
export function cancelRate(p: Pick<MerchantPerformance, 'delivered_orders' | 'cancelled_orders'>): number | null {
  const done = p.delivered_orders + p.cancelled_orders;
  return done > 0 ? Math.round((p.cancelled_orders / done) * 100) : null;
}

export function alertCounts(a: AlertsLike | null): { low: number; expiring: number; expired: number; total: number } {
  const low = a?.low_stock.length ?? 0;
  const expiring = a?.expiring_soon.length ?? 0;
  const expired = a?.expired.length ?? 0;
  return { low, expiring, expired, total: low + expiring + expired };
}

/** Searches in the province that found nothing: what buyers want and no one lists. Most searched first. */
export function unmetSearches(d: DemandInsight | null, n = 5): DemandTerm[] {
  return (d?.most_searched ?? [])
    .filter((t) => t.no_result_searches > 0)
    .sort((a, b) => b.no_result_searches - a.no_result_searches || b.searches - a.searches)
    .slice(0, n);
}

// ---------------------------------------------------------------- S19: the web home

export const DASHBOARD_WORDS = {
  eyebrow: 'Overview',
  fallbackTitle: 'Dashboard',
  viewOrders: 'View orders',
  addProduce: 'Add produce',
  attentionTitle: 'Needs your attention',
  nothingWaiting: 'Nothing waiting',
  allClear: 'You’re all caught up.',
  revenueTitle: 'Revenue',
  revenueSub: 'Last 30 days. Cancelled orders are not included.',
  revenueSubCompared: 'Last 30 days, against the 30 days before. Cancelled orders are not included.',
  ordersTitle: 'Orders per day',
  ordersSub: 'Last 30 days',
  noSales: 'No sales in the last 30 days.',
  noOrders: 'No orders in the last 30 days.',
  salesError: 'We could not load your sales. Pull down to try again.',
  recentTitle: 'Recent orders',
  allOrders: 'All orders',
  noOrdersYet: 'No orders yet.',
  loadingOrders: 'Loading orders…',
} as const;

/** "Welcome back, Juan. This is how your shop is doing." (web header; first name only). */
export function greeting(userName: string | null | undefined): string {
  const first = (userName ?? '').trim().split(/\s+/)[0];
  return `${first ? `Welcome back, ${first}. ` : ''}This is how your shop is doing.`;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

type Day = MerchantSales['daily'][number];

/** The web's sales windows. The API gives every day, oldest first, with zeros (fetched for 90 days). */
export function salesWindows(daily: readonly Day[]) {
  const last30 = daily.slice(-30);
  const prev30 = daily.length >= 60 ? daily.slice(-60, -30) : [];
  return {
    last30,
    last14: daily.slice(-14),
    rev30: sum(last30.map((d) => d.revenue)),
    revPrev30: sum(prev30.map((d) => d.revenue)),
    orders30: sum(last30.map((d) => d.orders)),
    ordersPrev30: sum(prev30.map((d) => d.orders)),
    hasPrevious: prev30.length > 0,
  };
}

/** The web `Delta` chip: whole percent change, or null when there is nothing to compare with. */
export function deltaPercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** "↑ 12%" / "↓ 5%", or '' with no previous period. */
export function deltaLabel(current: number, previous: number): string {
  const pct = deltaPercent(current, previous);
  return pct === null ? '' : `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct)}%`;
}

/**
 * Bar heights in percent of the tallest value (plain `View` bars, decision §2.2). `min` keeps
 * a zero visible as a stub, as the web sparkline does (12%); 0 draws zeros flat.
 */
export function barHeights(values: readonly number[], min = 0): number[] {
  const max = Math.max(...values, 0);
  return values.map((v) => (max > 0 ? Math.max(min, (Math.max(0, v) / max) * 100) : min));
}

/** "₱12k" above 1,000, as the web chart's axis. */
export const compactPeso = (v: number): string => (v >= 1000 ? `₱${(v / 1000).toFixed(0)}k` : `₱${Math.round(v)}`);

export type StatCard = {
  key: 'revenue' | 'orders' | 'active' | 'payout' | 'produce' | 'rating';
  label: string;
  value: string;
  sub: string;
  delta?: string;
  route?: string;
  /** Web statCardAlert: the card asks for action. */
  alert?: boolean;
};

export type StatInput = {
  performance: MerchantPerformance;
  sales: MerchantSales | null;
  /** Orders from the shared context; null until they load (the web then uses performance). */
  orders: readonly Pick<ApiMerchantOrder, 'status' | 'shipped' | 'shipment_id'>[] | null;
  produce: readonly Pick<ApiProduce, 'stock_quantity'>[] | null;
  lowStock: number;
  available: { net_amount: number; transaction_count: number } | null;
};


/** The six web stat cards, in the web's order. */
export function statCards({ performance: p, sales, orders, produce, lowStock, available }: StatInput): StatCard[] {
  const w = salesWindows(sales?.daily ?? []);
  const readyToShip = orders ? readyToShipCount(orders) : 0;
  const activeCount = orders ? orders.filter((o) => ACTIVE_ORDER_STATUSES.has(o.status)).length : p.active_orders;
  const productCount = produce ? produce.length : p.total_products;
  const outOfStock = produce ? produce.filter((x) => x.stock_quantity === 0).length : 0;
  const deliveredPct = p.total_orders > 0 ? (p.delivered_orders / p.total_orders) * 100 : 0;
  const plural = (n: number, one: string) => `${n.toLocaleString('en-PH')} ${one}${n === 1 ? '' : 's'}`;
  return [
    {
      key: 'revenue', label: 'Revenue, last 30 days', value: formatPeso(w.rev30),
      sub: `${formatPeso(p.total_revenue)} all time`, delta: deltaLabel(w.rev30, w.revPrev30),
    },
    {
      key: 'orders', label: 'Orders, last 30 days', value: w.orders30.toLocaleString('en-PH'),
      sub: `${p.total_orders.toLocaleString('en-PH')} all time`, delta: deltaLabel(w.orders30, w.ordersPrev30),
      route: '/(tabs)/orders',
    },
    {
      key: 'active', label: 'Active orders', value: activeCount.toLocaleString('en-PH'),
      sub: `${p.delivered_orders.toLocaleString('en-PH')} delivered (${Math.round(deliveredPct)}%)`,
      route: readyToShip > 0 ? '/shipments' : '/(tabs)/orders', alert: readyToShip > 0,
    },
    {
      key: 'payout', label: 'Ready to cash out', value: available ? formatPeso(available.net_amount) : '—',
      sub: available ? `${plural(available.transaction_count, 'paid order')}, after fees` : 'Open Earnings to see payouts',
      route: '/earnings',
    },
    {
      key: 'produce', label: 'Produce listed', value: productCount.toLocaleString('en-PH'),
      sub: `${lowStock} low stock · ${outOfStock} out of stock`, route: '/inventory', alert: outOfStock > 0,
    },
    {
      key: 'rating', label: 'Rating',
      value: p.rating == null ? '—' : `${Number(p.rating).toFixed(1)} / 5`,
      sub: p.rating_count ? `${plural(p.rating_count, 'review')} →` : 'No reviews yet',
      route: '/reviews',
    },
  ];
}

export type AttentionTone = 'green' | 'blue' | 'amber' | 'violet' | 'red';

export type AttentionRow = {
  key: 'ship' | 'delivery' | 'low' | 'out' | 'expiry' | 'payout' | 'paused' | 'setup';
  tone: AttentionTone;
  label: string;
  count: number;
  route: string;
  /** What to do; the screen shows DASHBOARD_WORDS.nothingWaiting instead when count is 0. */
  action: string;
};

export type AttentionInput = {
  orders: readonly Pick<ApiMerchantOrder, 'status' | 'shipped' | 'shipment_id'>[];
  produce: readonly Pick<ApiProduce, 'stock_quantity'>[];
  alerts: (AlertsLike & { low_stock_threshold?: number }) | null;
  /** Newest first (GET /merchants/me/payouts). */
  payouts: readonly Pick<MerchantPayoutBatch, 'status'>[];
  shopPage: Pick<ApiShopPage, 'is_published'> | null;
  merchant: Pick<ApiMyMerchant, 'lat' | 'lng' | 'paused_until'> | null;
  /** Manila yyyy-mm-dd; tests pass a fixed day. */
  today?: string;
};

/**
 * The web "Needs your attention" rows, in the web's order. Routes are the mobile screens: the
 * web opens /shop for holiday mode and the pickup pin (one page there); on the phone both live
 * in Store settings (S16).
 */
export function attentionRows({ orders, produce, alerts, payouts, shopPage, merchant, today }: AttentionInput): AttentionRow[] {
  const readyToShip = readyToShipCount(orders);
  const inDelivery = orders.filter((o) => o.status === 'shipped' || o.status === 'out_for_delivery').length;
  const outOfStock = produce.filter((p) => p.stock_quantity === 0).length;
  const lowStock = alerts?.low_stock.length ?? 0;
  const expiring = (alerts?.expiring_soon.length ?? 0) + (alerts?.expired.length ?? 0);
  // Newest first: a failure that was resent since is no longer the latest batch.
  const payoutFailed = payouts[0]?.status === 'failed' ? 1 : 0;
  const shopLive = shopPage?.is_published === true;
  const pinMissing = !!merchant && (merchant.lat == null || merchant.lng == null);
  const setupMissing = (shopLive ? 0 : 1) + (pinMissing ? 1 : 0);
  // CF-0078 (B89): holiday mode is easy to forget once it is on.
  const pausedThrough = activePause(merchant?.paused_until, today);
  return [
    { key: 'ship', tone: 'amber', label: 'Ready to ship', count: readyToShip, route: '/shipments', action: 'Paid orders to put on a route' },
    { key: 'delivery', tone: 'blue', label: 'In delivery', count: inDelivery, route: '/(tabs)/orders', action: 'Orders on the road' },
    { key: 'low', tone: 'amber', label: 'Low stock', count: lowStock, route: '/inventory', action: `At or below ${alerts?.low_stock_threshold ?? 5} left` },
    { key: 'out', tone: 'red', label: 'Out of stock', count: outOfStock, route: '/inventory', action: 'Buyers cannot order these' },
    { key: 'expiry', tone: 'red', label: 'Best-before soon or past', count: expiring, route: '/inventory', action: 'Sell or remove these first' },
    { key: 'payout', tone: 'red', label: 'Payout failed', count: payoutFailed, route: '/earnings', action: 'Check your payout details' },
    {
      key: 'paused', tone: 'amber', label: 'Shop close mode', count: pausedThrough ? 1 : 0, route: '/settings',
      action: pausedThrough ? `Orders are paused through ${shortDay(pausedThrough)}` : 'Your store takes orders',
    },
    {
      key: 'setup', tone: 'violet', label: 'Shop setup', count: setupMissing,
      // The web names the pin once the page is live; the pin is set in Store settings here.
      route: shopLive ? '/settings' : '/shop',
      action: shopLive ? 'Set your farm pickup pin' : shopPage ? 'Publish your shop page' : 'Create your public shop page',
    },
  ];
}

export const openTotal = (rows: readonly AttentionRow[]): number => sum(rows.map((r) => r.count));

/** The newest orders first (web: 6). */
export function recentOrders<T extends Pick<ApiMerchantOrder, 'ordered_at'>>(orders: readonly T[], n = 6): T[] {
  return [...orders].sort((a, b) => b.ordered_at.localeCompare(a.ordered_at)).slice(0, n);
}

// ---------------------------------------------------------------- no farm yet (web MerchantWelcome)

export type WelcomeView = {
  title: string;
  body: string;
  /** 'onboarding' opens /onboarding; 'support' opens the help pages. */
  action?: { label: string; to: 'onboarding' | 'support' };
};

/**
 * What a signed-in account with no farm sees, by its merchant application (web
 * MerchantWelcome, backend application_review.py): none yet, under review, more information
 * needed, not approved, or suspended.
 */
export function merchantWelcome(applicationStatus: string | null | undefined): WelcomeView {
  switch (applicationStatus) {
    case 'submitted':
      return {
        title: 'Application under review',
        body: 'We are checking your merchant application. We will tell you by email and in your notifications when we approve it.',
      };
    case 'pending_documents':
      return {
        title: 'Finish your business information to start selling',
        body: 'We saved your contact and operations details. Add your business, tax and document details to send your application for review.',
        action: { label: 'Finish business information', to: 'onboarding' },
      };
    case 'clarification':
      return {
        title: 'More information needed',
        body: 'We need more information about your application. Open the application, change the details and send it again.',
        action: { label: 'Update application', to: 'onboarding' },
      };
    case 'rejected':
      return {
        title: 'Application not approved',
        body: 'We did not approve your merchant application. You can correct it and send it again.',
        action: { label: 'Apply again', to: 'onboarding' },
      };
    case 'suspended':
      return {
        title: 'Merchant account suspended',
        body: 'This merchant account is suspended. Contact Carabao support for help.',
        action: { label: 'Contact support', to: 'support' },
      };
    default:
      // No application yet, or a closed merchant ("approved" with no profile).
      return {
        title: 'Welcome to Carabao Merchant Centre!',
        body: 'To get started, register as a merchant. Tell us about your farm or business, and we will review your application.',
        action: { label: 'Start Registration', to: 'onboarding' },
      };
  }
}
