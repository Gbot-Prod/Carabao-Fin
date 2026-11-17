// CF-0043: merchant reply to a review. Pure, so `npm test` runs it.
// Keep REPLY_MAX_LENGTH in step with backend app/schemas/review.py.

export const REPLY_MAX_LENGTH = 1000;

/** Why this reply can't be sent, or null when it can. Same rules as the API. */
export function replyProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return 'Write a reply first.';
  if (trimmed.length > REPLY_MAX_LENGTH) return `Keep your reply under ${REPLY_MAX_LENGTH} characters.`;
  return null;
}
