// CF-0112: a farm's public reviews (GET /merchants/{id}/reviews, backend
// MerchantReviewsResponse). Pure, for `npm test`.

export type PublicReview = {
  id: number;
  merchant_id: number;
  rating: number; // 1-5
  comment: string | null;
  reviewer_name: string;
  created_at: string;
  updated_at: string;
  // CF-0133 (M55): the farm's one public reply (backend PublicReviewResponse, CF-0043).
  merchant_reply?: string | null;
  merchant_replied_at?: string | null;
};

export type MerchantReviews = {
  merchant_id: number;
  rating: number | null;
  rating_count: number;
  reviews: PublicReview[];
  limit: number;
  offset: number;
};

export const REVIEWS_FIRST_PAGE = 5;
export const REVIEWS_MORE_PAGE = 10;

/** "★★★★☆" for 4; the rating is clamped to 0-5 and rounded. */
export function stars(rating: number): string {
  const n = Math.max(0, Math.min(5, Math.round(Number.isFinite(rating) ? rating : 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/** "4.5 · 12 reviews", "5.0 · 1 review", "No reviews yet". */
export function reviewSummary(rating: number | null, count: number): string {
  if (!count || rating === null || !Number.isFinite(rating)) return 'No reviews yet';
  return `${rating.toFixed(1)} · ${count} review${count === 1 ? '' : 's'}`;
}

/** Add a page; a review already shown is not added again (new reviews shift the offsets). */
export function mergeReviews(prev: PublicReview[], page: PublicReview[]): PublicReview[] {
  const seen = new Set(prev.map((r) => r.id));
  return [...prev, ...page.filter((r) => !seen.has(r.id))];
}

/** True while the farm has more reviews than are shown. */
export function hasMoreReviews(shown: number, total: number): boolean {
  return shown < total;
}

/** "Edited" when the review was changed more than a minute after it was written. */
export function wasEdited(r: Pick<PublicReview, 'created_at' | 'updated_at'>): boolean {
  const c = Date.parse(r.created_at);
  const u = Date.parse(r.updated_at);
  return Number.isFinite(c) && Number.isFinite(u) && u - c > 60_000;
}

/** Web en.ts `shop.farmReply`: "Reply from {farm}"; "the farm" when the name is not known yet. */
export function farmReplyLabel(farm: string | null | undefined): string {
  const name = (farm ?? '').trim();
  return `Reply from ${name || 'the farm'}`;
}

/** A reply with text after trimming; null for a missing or blank one. */
export function shownReply(r: Pick<PublicReview, 'merchant_reply'>): string | null {
  const text = typeof r.merchant_reply === 'string' ? r.merchant_reply.trim() : '';
  return text || null;
}
