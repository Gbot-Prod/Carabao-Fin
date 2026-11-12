import { apiClient } from './client';

// Market reference ranges (P1). Mirrors backend ReferencePriceResponse.
export type ReferencePrice = {
  id: number;
  commodity: string;
  aliases: string[];
  unit: string;
  low: number;
  high: number;
  source: string;
  as_of: string; // YYYY-MM-DD
  is_sample: boolean; // placeholder row: always label it as a sample
};

let cached: Promise<ReferencePrice[]> | null = null;

/** Every reference price, fetched once per page load. */
export const fetchReferencePrices = (): Promise<ReferencePrice[]> => {
  if (!cached) {
    cached = apiClient
      .get<ReferencePrice[]>('/reference-prices')
      .then((res) => res.data)
      .catch((err) => {
        cached = null; // let the next caller retry
        throw err;
      });
  }
  return cached;
};

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The reference price whose commodity or alias appears as whole words in the
 * produce name; the longest name wins and a row in the same unit is preferred.
 * Mirrors match() in backend/app/services/reference_prices.py.
 */
export function matchReferencePrice(
  prices: ReferencePrice[],
  produceName: string | null | undefined,
  unit?: string | null,
): ReferencePrice | null {
  if (!produceName) return null;
  const padded = ` ${norm(produceName)} `;
  let best: { len: number; sameUnit: number; price: ReferencePrice } | null = null;
  for (const price of prices) {
    for (const raw of [price.commodity, ...price.aliases]) {
      const name = norm(raw);
      if (!name || !padded.includes(` ${name} `)) continue;
      const sameUnit = unit && price.unit === unit ? 1 : 0;
      if (!best || name.length > best.len || (name.length === best.len && sameUnit > best.sameUnit)) {
        best = { len: name.length, sameUnit, price };
      }
    }
  }
  return best?.price ?? null;
}
