// CF-0094 (B102): the search price filters as the backend takes them. The API
// refuses (422) a price that is not a whole number of pesos from 0 to
// PRICE_FILTER_MAX (backend app/schemas/produce.py MAX_PRICE, kept in step),
// so the field must not turn a typo into an error page.
export const PRICE_FILTER_MAX = 1_000_000;

/** The query value for a typed price, or undefined when there is no filter. */
export function priceFilter(raw: string): number | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.floor(value), PRICE_FILTER_MAX);
}
