// CF-0113: the buyer's review of a delivered order (POST / PATCH
// /orders/me/{id}/review). Same rules as backend schemas/review.py and
// services/review_service.py. Pure, for `npm test`.

export const REVIEW_COMMENT_MAX = 2000; // backend COMMENT_MAX_LENGTH

/** The body to send, or the problem. A blank comment is sent as null (clears it on edit). */
export function checkReview(
  rating: number | null,
  comment: string,
): { ok: { rating: number; comment: string | null } } | { error: string } {
  if (rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: 'Choose 1 to 5 stars.' };
  }
  const text = comment.trim();
  if (text.length > REVIEW_COMMENT_MAX) {
    return { error: `A review can have at most ${REVIEW_COMMENT_MAX} characters.` };
  }
  return { ok: { rating, comment: text || null } };
}

/** True while the review window is open (backend refuses edits after it). */
export function canEditReview(editableUntil: string | null | undefined, now: number = Date.now()): boolean {
  if (!editableUntil) return false;
  const t = Date.parse(editableUntil);
  return Number.isFinite(t) && now <= t;
}

/** The words a screen reader says for a star button. */
export function starLabel(n: number): string {
  return `${n} star${n === 1 ? '' : 's'}`;
}
