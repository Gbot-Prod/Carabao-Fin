// CF-0125: the merchant dashboard (web merchant shell home): performance numbers
// (GET /merchants/me/performance), stock alerts, and demand in the merchant's
// province (GET /merchants/me/demand). Pure, for `npm test`.

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

/**
 * The "not live yet" banner while Carabao has not verified the farm, or null.
 * The merchant screens open for any merchant row; the server refuses selling.
 * Business documents are sent on the web Merchant Centre.
 */
export function verificationBanner(status: string | undefined): string | null {
  switch (status) {
    case undefined:
    case 'verified':
      return null;
    case 'setup':
      return 'Your shop isn’t live yet. Next: add your business information in the Merchant Centre on the web.';
    case 'under_review':
      return 'Your shop isn’t live yet. Carabao is reviewing your documents; you can keep adding produce.';
    case 'needs_changes':
      return 'Your shop isn’t live yet. Carabao asked for changes to your business information (Merchant Centre on the web).';
    case 'suspended':
      return 'Your shop is suspended, so buyers cannot see it. Contact Carabao support.';
    default:
      return 'Your shop isn’t live yet.';
  }
}

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

/** The number tiles, most used first. */
export function statTiles(p: MerchantPerformance): { key: string; label: string; value: string }[] {
  return [
    { key: 'active', label: 'Open orders', value: String(p.active_orders) },
    { key: 'rev30', label: 'Sales, last 30 days', value: peso(p.last_30_days_revenue) },
    { key: 'ord30', label: 'Orders, last 30 days', value: String(p.last_30_days_orders) },
    { key: 'delivered', label: 'Delivered', value: String(p.delivered_orders) },
    { key: 'revenue', label: 'Sales, all time', value: peso(p.total_revenue) },
    { key: 'products', label: 'Listings', value: String(p.total_products) },
  ];
}

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
