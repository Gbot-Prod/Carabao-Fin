// CF-0102: paged order history (GET /orders/me/history/page).
// The first part is a copy of the web's frontend/carabao-app/lib/order-history.ts (CF-0036):
// keep the two in step. The paging helpers below it are mobile only (infinite scroll).
// Pure: covered by `npm test`.

export type HistoryFilter = 'active' | 'delivered' | 'cancelled';

export const HISTORY_PAGE_SIZE = 10;
// Same limit as the API's `q` (max_length=100).
export const HISTORY_SEARCH_MAX = 100;

export const HISTORY_FILTERS: { value: HistoryFilter | ''; label: string }[] = [
  { value: '', label: 'All orders' },
  { value: 'active', label: 'In progress' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

export type HistoryQuery = { page: number; status?: HistoryFilter | ''; q?: string };

/** Query params for the API: empty filters left out, search trimmed and capped. */
export function historyParams({ page, status, q }: HistoryQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {
    page: Math.max(1, Math.floor(page) || 1),
    page_size: HISTORY_PAGE_SIZE,
  };
  if (status) params.status = status;
  const term = (q ?? '').trim().slice(0, HISTORY_SEARCH_MAX);
  if (term) params.q = term;
  return params;
}

/** The page to show after one order is removed: step back if it was the last one on a later page. */
export function pageAfterRemoval(page: number, totalBefore: number, pageSize = HISTORY_PAGE_SIZE): number {
  const remaining = Math.max(0, totalBefore - 1);
  const lastPage = Math.max(1, Math.ceil(remaining / pageSize));
  return Math.min(page, lastPage);
}

// ---- mobile only ----

/** `historyParams` as a URL query string (the mobile API client takes a path, not a params object). */
export function historyQueryString(query: HistoryQuery): string {
  const params = historyParams(query);
  return Object.keys(params)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}

/**
 * Add the next page to the list. Page 1 replaces the list. An order that is already
 * shown is not added again (a new order placed while scrolling moves the others down a slot).
 */
export function mergeHistoryPage<T extends { id: number }>(prev: T[], items: T[], page: number): T[] {
  if (page <= 1) return items;
  const seen = new Set(prev.map((o) => o.id));
  return [...prev, ...items.filter((o) => !seen.has(o.id))];
}

/** True while the server has pages after `page`. */
export function hasMoreHistory(page: number, total: number, pageSize = HISTORY_PAGE_SIZE): boolean {
  return page * pageSize < total;
}
