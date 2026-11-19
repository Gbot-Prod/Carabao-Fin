// CF-0118: produce search with filters, sort and paging (web util/api/produceSearch.ts
// and order/ProduceResults.tsx; backend GET /produce/search). Labels = web en.ts
// `search.*`. Pure, for `npm test`.

export type ProduceSort = 'relevance' | 'price_asc' | 'price_desc' | 'freshest' | 'newest';

export const SORTS: { value: ProduceSort; label: string }[] = [
  { value: 'relevance', label: 'Best match' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'freshest', label: 'Most recently harvested' },
  { value: 'newest', label: 'Newest listings' },
];

export const CATEGORIES = ['Vegetables', 'Fruits'] as const;
export const SEARCH_PAGE_SIZE = 24; // web PAGE_SIZE; backend allows up to 60
export const SEARCH_Q_MAX = 100; // backend max_length

export type SearchFilters = {
  q: string;
  category: '' | (typeof CATEGORIES)[number];
  minPrice: string;
  maxPrice: string;
  inStock: boolean;
  fresh: boolean;
  sort: ProduceSort;
};

export const NO_FILTERS: SearchFilters = {
  q: '', category: '', minPrice: '', maxPrice: '', inStock: true, fresh: false, sort: 'relevance',
};

function price(value: string): number | null | 'bad' {
  const v = value.trim();
  if (!v) return null;
  return /^\d{1,7}$/.test(v) ? Number(v) : 'bad';
}

/** The query string for a page, or the problem with the filters. Empty values are left out (as on the web). */
export function searchQuery(f: SearchFilters, page: number): { ok: string } | { error: string } {
  const min = price(f.minPrice);
  const max = price(f.maxPrice);
  if (min === 'bad' || max === 'bad') return { error: 'Prices are whole pesos.' };
  if (min !== null && max !== null && min > max) return { error: 'Min ₱ is above max ₱.' };
  const parts: [string, string][] = [];
  const q = f.q.trim().slice(0, SEARCH_Q_MAX);
  if (q) parts.push(['q', q]);
  if (f.category) parts.push(['category', f.category]);
  if (min !== null) parts.push(['min_price', String(min)]);
  if (max !== null) parts.push(['max_price', String(max)]);
  if (f.inStock) parts.push(['in_stock', 'true']);
  if (f.fresh) parts.push(['fresh', 'true']);
  if (f.sort !== 'relevance') parts.push(['sort', f.sort]);
  parts.push(['page', String(Math.max(1, Math.floor(page) || 1))], ['page_size', String(SEARCH_PAGE_SIZE)]);
  return { ok: parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') };
}

/** How many filters differ from the defaults (for the "Filters (2)" button). Query text not counted. */
export function activeFilterCount(f: SearchFilters): number {
  let n = 0;
  if (f.category) n += 1;
  if (f.minPrice.trim()) n += 1;
  if (f.maxPrice.trim()) n += 1;
  if (f.inStock !== NO_FILTERS.inStock) n += 1;
  if (f.fresh) n += 1;
  if (f.sort !== 'relevance') n += 1;
  return n;
}
