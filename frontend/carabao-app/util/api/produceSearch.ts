import { apiClient } from './client';
import type { Produce } from './produce';
import type { Paginated } from './admin';

// GET /produce/search (U2): buyer-visible listings with filters and sorting.

export type ProduceSort = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'freshest';

export type ProduceSearchParams = {
  q?: string;
  category?: string;
  province?: string;
  min_price?: number;
  max_price?: number;
  in_stock?: boolean;
  fresh?: boolean;
  sort?: ProduceSort;
  page?: number;
  page_size?: number;
};

export type ProduceSearchResult = Produce & {
  merchant_name: string;
  merchant_province: string | null;
  merchant_city: string | null;
  /** CF-0072: the farm's holiday mode when it is on today (yyyy-mm-dd). */
  merchant_paused_until?: string | null;
};

/** CF-0081: GET /produce/{id}: one listing, its farm, the same produce elsewhere. */
export type ListingFarm = {
  id: number;
  merchant_name: string;
  province: string | null;
  city: string | null;
  rating: number | null;
  rating_count: number;
  paused_until: string | null;
};

export type ListingDetail = {
  listing: Produce;
  farm: ListingFarm;
  /** Other farms' listings of the same produce, cheapest first (max 10). */
  other_farms: ProduceSearchResult[];
};

export const fetchListing = async (produceId: number): Promise<ListingDetail> => {
  const res = await apiClient.get<ListingDetail>(`/produce/${produceId}`);
  return res.data;
};

export const searchProduce = async (params: ProduceSearchParams): Promise<Paginated<ProduceSearchResult>> => {
  // Drop empty values so the server applies no filter for them.
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== false),
  );
  const res = await apiClient.get<Paginated<ProduceSearchResult>>('/produce/search', { params: clean });
  return res.data;
};
