import { apiClient } from './client';

// A review as anyone browsing the shop sees it: no link to the order.
export type PublicReview = {
  id: number;
  merchant_id: number;
  rating: number; // 1–5
  comment: string | null;
  reviewer_name: string;
  created_at: string;
  updated_at: string;
};

// A review as its buyer or the reviewed merchant sees it.
export type Review = PublicReview & {
  order_id: number | null;
  editable_until: string | null;
};

export type ReviewPayload = {
  rating: number;
  comment?: string | null;
};

export type MerchantReviews = {
  merchant_id: number;
  rating: number | null;
  rating_count: number; // 0 → show "No reviews yet"
  reviews: PublicReview[];
  limit: number;
  offset: number;
};

export type MyMerchantReviews = {
  merchant_id: number;
  rating: number | null;
  rating_count: number;
  // Keyed "1"–"5"; covers every review regardless of filters.
  rating_breakdown: Record<string, number>;
  with_comment_count: number;
  total: number; // reviews matching the filters, for pagination
  reviews: Review[];
  limit: number;
  offset: number;
};

export type MyMerchantReviewsQuery = {
  ratings?: number[];
  hasComment?: boolean;
  limit?: number;
  offset?: number;
};

export const createOrderReview = async (orderId: number, payload: ReviewPayload): Promise<Review> => {
  const response = await apiClient.post<Review>(`/orders/me/${orderId}/review`, payload);
  return response.data;
};

export const updateOrderReview = async (orderId: number, payload: Partial<ReviewPayload>): Promise<Review> => {
  const response = await apiClient.patch<Review>(`/orders/me/${orderId}/review`, payload);
  return response.data;
};

export const fetchMerchantReviews = async (
  merchantId: number,
  params: { limit?: number; offset?: number } = {},
): Promise<MerchantReviews> => {
  const response = await apiClient.get<MerchantReviews>(`/merchants/${merchantId}/reviews`, { params });
  return response.data;
};

export const fetchMyMerchantReviews = async ({
  ratings,
  hasComment,
  limit,
  offset,
}: MyMerchantReviewsQuery = {}): Promise<MyMerchantReviews> => {
  // FastAPI reads list params as repeated keys (rating=1&rating=2), not rating[].
  const params = new URLSearchParams();
  ratings?.forEach((stars) => params.append('rating', String(stars)));
  if (hasComment !== undefined) params.set('has_comment', String(hasComment));
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const response = await apiClient.get<MyMerchantReviews>('/merchants/me/reviews', { params });
  return response.data;
};
