import { apiClient } from './client';

// Unit price once a cart line reaches min_qty sale units; the server applies it.
export type PriceTier = { min_qty: number; unit_price: number };

export type Produce = {
  id: number;
  merchant_id: number;
  name: string | null;
  description: string | null;
  category: 'Vegetables' | 'Fruits' | null;
  price: number;
  unit: 'kg' | 'lbs';
  unit_quantity: number;
  stock_quantity: number;
  image_url: string | null;
  // ISO dates (YYYY-MM-DD); null on listings created before they were collected.
  harvest_date: string | null;
  best_before: string | null;
  min_order_qty: number;
  price_tiers: PriceTier[];
  // Set when an admin hides the listing (A6); only the merchant ever sees these.
  hidden_at?: string | null;
  hidden_reason?: string | null;
  // Guardrails Phase 1 (backend models/statuses.py ProduceStatus). Buyers see
  // live and under_review listings.
  status?: ProduceStatus;
  // Only on the merchant's own listings (MerchantProduceResponse) and for admins.
  review_flags?: ListingIssue[];
  submitted_for_review_at?: string | null;
  reviewed_at?: string | null;
  rejection_code?: string | null;
  rejection_reason?: string | null;
};

export type ProduceStatus = 'live' | 'under_review' | 'rejected' | 'hidden';

/** One result of the listing checker (backend services/listing_checks.py). */
export type ListingIssue = {
  field: string;
  code: string;
  message: string;
  /** A value the form can apply with one click (category). */
  suggestion?: string | null;
};

export type ProduceCheckPayload = Partial<ProduceCreatePayload> & {
  /** The listing being edited: left out of the duplicate check. */
  produce_id?: number | null;
};

export type ProduceCheckResult = {
  valid: boolean;
  has_hard_blocks: boolean;
  has_soft_flags: boolean;
  recommended_status: ProduceStatus;
  hard_blocks: ListingIssue[];
  soft_flags: ListingIssue[];
};

export type ProduceCreatePayload = {
  name: string;
  description?: string | null;
  category?: 'Vegetables' | 'Fruits' | null;
  price: number;
  unit?: 'kg' | 'lbs';
  unit_quantity?: number;
  stock_quantity?: number;
  image_url?: string | null;
  harvest_date: string;
  best_before: string;
  min_order_qty?: number;
  price_tiers?: PriceTier[];
};

export type ProduceUpdatePayload = {
  name?: string | null;
  description?: string | null;
  category?: 'Vegetables' | 'Fruits' | null;
  price?: number | null;
  unit?: 'kg' | 'lbs' | null;
  unit_quantity?: number | null;
  stock_quantity?: number | null;
  // CF-0049: the stock the form loaded; the server answers 409 if it changed.
  expected_stock_quantity?: number | null;
  image_url?: string | null;
  harvest_date?: string;
  best_before?: string;
  min_order_qty?: number;
  price_tiers?: PriceTier[];
};

export const fetchMerchantProduce = async (merchantId: number): Promise<Produce[]> => {
  const response = await apiClient.get<Produce[]>(`/merchants/${merchantId}/produce`);
  return response.data;
};

/** Every listing of the signed-in merchant, expired ones included. */
export const fetchMyProduce = async (): Promise<Produce[]> => {
  const response = await apiClient.get<Produce[]>('/merchants/me/produce');
  return response.data;
};

/** Guardrails Phase 2: one penalty row (backend services/listing_trust.py). */
export type ListingPenalty = {
  id: number;
  produce_id: number | null;
  produce_name: string;
  code: string;
  label: string;
  points: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
};

/** Penalty points, the new-listing block, and the new-farm review. */
export type ListingStanding = {
  points: number;
  window_days: number;
  listing_block_points: number;
  account_review_points: number;
  can_create_listings: boolean;
  blocked_until: string | null;
  new_merchant_reviews_left: number;
  penalties: ListingPenalty[];
};

export const fetchListingStanding = async (): Promise<ListingStanding> => {
  const response = await apiClient.get<ListingStanding>('/merchants/me/listing-standing');
  return response.data;
};

/** Guardrails Phase 3 (backend services/listing_reports.py REPORT_REASONS). */
export const LISTING_REPORT_REASONS = [
  'NOT_AS_DESCRIBED',
  'MISLEADING_PHOTO',
  'PROHIBITED_ITEM',
  'CONTACT_OR_PAYMENT',
  'MISLEADING_PRICE',
  'SPAM',
  'OTHER',
] as const;
export type ListingReportReason = (typeof LISTING_REPORT_REASONS)[number];

/** A buyer reports a listing; it goes to the admin review queue. */
export const reportListing = async (
  produceId: number,
  payload: { reason: ListingReportReason; note?: string | null },
): Promise<void> => {
  await apiClient.post(`/produce/${produceId}/report`, payload);
};

export const createProduce = async (payload: ProduceCreatePayload): Promise<Produce> => {
  const response = await apiClient.post<Produce>('/produce/', payload);
  return response.data;
};

export const updateProduce = async (produceId: number, payload: ProduceUpdatePayload): Promise<Produce> => {
  const response = await apiClient.patch<Produce>(`/produce/${produceId}`, payload);
  return response.data;
};

/** Guardrails: check the form while the merchant types. Saves nothing. */
export const checkProduce = async (
  payload: ProduceCheckPayload,
  signal?: AbortSignal,
): Promise<ProduceCheckResult> => {
  const response = await apiClient.post<ProduceCheckResult>('/produce/check', payload, { signal });
  return response.data;
};

export const deleteProduce = async (produceId: number): Promise<void> => {
  await apiClient.delete(`/produce/${produceId}`);
};

export const uploadProduceImage = async (produceId: number, file: File): Promise<Produce> => {
  const formData = new FormData();
  formData.append('image', file);
  const response = await apiClient.post<Produce>(`/produce/${produceId}/image`, formData);
  return response.data;
};
