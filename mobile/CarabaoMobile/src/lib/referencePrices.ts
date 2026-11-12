// Market reference ranges (P1). Mirrors backend ReferencePriceResponse and the
// match() helper in backend/app/services/reference_prices.py.

export type ApiReferencePrice = {
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

const norm = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Whole-word match on commodity or alias; longest wins, same unit preferred. */
export function matchReferencePrice(
  prices: ApiReferencePrice[],
  produceName: string | null | undefined,
  unit?: string | null,
): ApiReferencePrice | null {
  if (!produceName) return null;
  const padded = ` ${norm(produceName)} `;
  let best: { len: number; sameUnit: number; price: ApiReferencePrice } | null = null;
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

/** "Market ref: ₱10–₱20/kg (sample)" — information only, never a price cap. */
export function referenceLabel(price: ApiReferencePrice): string {
  const range = `₱${price.low.toLocaleString()}–₱${price.high.toLocaleString()}/${price.unit}`;
  return `Market ref: ${range}${price.is_sample ? ' (sample data)' : ` · ${price.source}`}`;
}
