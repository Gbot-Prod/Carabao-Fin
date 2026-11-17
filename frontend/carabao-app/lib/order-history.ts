// CF-0036: paged order history (GET /orders/me/history/page).
// Pure helpers, so `npm test` covers them without a browser.

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
