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
