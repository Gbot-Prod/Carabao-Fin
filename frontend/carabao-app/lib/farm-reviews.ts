// CF-0046 (B48): pure helpers for the public reviews list on the farm page.

export const REVIEWS_PAGE_SIZE = 5;

type WithId = { id: number };

/** Add a fetched page to the loaded reviews, keeping order and dropping repeats
 *  (a review posted between two page loads shifts the offset by one). */
export function appendReviews<T extends WithId>(loaded: T[], page: T[]): T[] {
  const seen = new Set(loaded.map((r) => r.id));
  return [...loaded, ...page.filter((r) => !seen.has(r.id))];
}

/** Whether "Show more" should appear. */
export function hasMoreReviews(loaded: number, total: number): boolean {
  return loaded < total;
}

/** Five stars, filled to the rating (1–5; out-of-range values are clamped). */
export function starsText(rating: number): string {
  const n = Math.min(5, Math.max(0, Math.round(Number.isFinite(rating) ? rating : 0)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

/** A review date in Manila time, e.g. "18 Nov 2026"; "" for a bad value. */
export function reviewDate(iso: string, lang: "en" | "fil"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "fil" ? "fil-PH" : "en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
}
