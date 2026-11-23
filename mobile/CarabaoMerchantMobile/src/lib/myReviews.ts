// The merchant half of the reviews code (moved out of the buyer app's src/lib/reviews.ts,
// plan D2): the display helpers both review screens use, and the "my reviews" screen's rules.
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

/** "Edited" when the review was changed more than a minute after it was written. */
export function wasEdited(r: Pick<PublicReview, 'created_at' | 'updated_at'>): boolean {
  const c = Date.parse(r.created_at);
  const u = Date.parse(r.updated_at);
  return Number.isFinite(c) && Number.isFinite(u) && u - c > 60_000;
}

// ---- the merchant's own reviews (GET /merchants/me/reviews), CF-0119 ----

export type MyReview = PublicReview & { order_id: number | null; editable_until: string | null };

export type MyMerchantReviews = {
  merchant_id: number;
  rating: number | null;
  rating_count: number;
  /** Keyed 1-5 (JSON keys arrive as strings); covers every review, not only the filtered ones. */
  rating_breakdown: Record<string, number>;
  with_comment_count: number;
  /** Reviews matching the filters, for paging. */
  total: number;
  reviews: MyReview[];
  limit: number;
  offset: number;
};

export type MyReviewsFilter = { ratings: number[]; hasComment: boolean | null };
export const MY_REVIEWS_PAGE = 20; // backend default limit

/** Query string: FastAPI reads a list as repeated keys (rating=1&rating=2), like the web. */
export function myReviewsQuery(f: MyReviewsFilter, offset: number, limit = MY_REVIEWS_PAGE): string {
  const parts = [...new Set(f.ratings)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5)
    .sort()
    .map((n) => `rating=${n}`);
  if (f.hasComment !== null) parts.push(`has_comment=${f.hasComment}`);
  parts.push(`limit=${limit}`, `offset=${Math.max(0, Math.floor(offset) || 0)}`);
  return parts.join('&');
}

/** 5 rows, 5 stars first, with the share of all reviews (0-100, whole). */
export function breakdownRows(breakdown: Record<string, number>, ratingCount: number): { stars: number; count: number; percent: number }[] {
  return [5, 4, 3, 2, 1].map((stars) => {
    const count = Number(breakdown[String(stars)] ?? 0) || 0;
    return { stars, count, percent: ratingCount > 0 ? Math.round((count / ratingCount) * 100) : 0 };
  });
}

/** Turn a star filter on or off. */
export function toggleRating(ratings: readonly number[], stars: number): number[] {
  return ratings.includes(stars) ? ratings.filter((n) => n !== stars) : [...ratings, stars].sort();
}

// ---- the farm's reply (PUT / DELETE /merchants/me/reviews/{id}/reply), CF-0133 ----
// Copied from web lib/review-reply.ts. Keep REPLY_MAX_LENGTH in step with backend
// app/schemas/review.py (inStep.test.ts checks it).

export const REPLY_MAX_LENGTH = 1000;

/** Why this reply can't be sent, or null when it can. Same rules as the API. */
export function replyProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return 'Write a reply first.';
  if (trimmed.length > REPLY_MAX_LENGTH) return `Keep your reply under ${REPLY_MAX_LENGTH} characters.`;
  return null;
}

/** A reply with text after trimming; null for a missing or blank one. */
export function shownReply(r: Pick<PublicReview, 'merchant_reply'>): string | null {
  const text = typeof r.merchant_reply === 'string' ? r.merchant_reply.trim() : '';
  return text || null;
}

/** Put the server's copy of one review in place of the old one (same position). */
export function replaceReview<T extends { id: number }>(list: readonly T[], updated: T): T[] {
  return list.map((r) => (r.id === updated.id ? updated : r));
}
