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
};

export const searchProduce = async (params: ProduceSearchParams): Promise<Paginated<ProduceSearchResult>> => {
  // Drop empty values so the server applies no filter for them.
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== false),
  );
  const res = await apiClient.get<Paginated<ProduceSearchResult>>('/produce/search', { params: clean });
  return res.data;
};
