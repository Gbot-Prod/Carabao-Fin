// CF-0107: checks for the listing create/edit form. Pure, for `npm test`.
// Same rules and messages as the backend: schemas/produce.py (bounds) and
// services/produce_freshness.py freshness_error (dates, in Philippine time).

export const LISTING_NAME_MAX = 100; // backend MAX_NAME
export const LISTING_PRICE_MAX = 1_000_000; // backend MAX_PRICE
export const LISTING_STOCK_MAX = 10_000_000; // backend MAX_STOCK
export const LISTING_TIERS_MAX = 5; // backend MAX_PRICE_TIERS (CF-0116)

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's date in the Philippines as YYYY-MM-DD (backend ph_today). */
export function phToday(now: Date = new Date()): string {
  return new Date(now.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);
}

/** A real calendar date written as YYYY-MM-DD, else null ("2026-02-30" is null). */
export function parseYmd(value: string): string | null {
  const v = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v ? v : null;
}

/** YYYY-MM-DD plus n days (n may be negative). */
export function addDays(ymd: string, n: number): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

/** Backend freshness_error, word for word. YYYY-MM-DD strings compare as dates. */
export function freshnessError(harvest: string | null, bestBefore: string | null, today: string): string | null {
  if (harvest === null || bestBefore === null) return 'Harvest date and best-before date are required';
  if (harvest > today) return 'Harvest date cannot be in the future';
  if (bestBefore < harvest) return 'Best-before date cannot be earlier than the harvest date';
  return null;
}

export type TierFields = { minQty: string; unitPrice: string };

export type ListingFields = {
  name: string;
  price: string;
  stock: string;
  harvestDate: string;
  bestBefore: string;
  /** Blank = 1 (CF-0116). */
  minOrderQty?: string;
  /** Rows with both boxes blank are left out. */
  tiers?: TierFields[];
};

export type PriceTier = { min_qty: number; unit_price: number };

export type ListingValues = {
  name: string;
  price: number;
  stock_quantity: number;
  harvest_date: string;
  best_before: string;
  min_order_qty: number;
  price_tiers: PriceTier[];
};

/** Backend services/produce_pricing.pricing_error, word for word. */
export function pricingError(price: number, minOrderQty: number, tiers: readonly PriceTier[]): string | null {
  const ordered = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  if (new Set(ordered.map((t) => t.min_qty)).size !== ordered.length) return 'Each price tier needs a different quantity';
  if (ordered.length && ordered[0].min_qty <= minOrderQty) return 'Price tiers must start above the minimum order quantity';
  let previous = price;
  for (const t of ordered) {
    if (t.unit_price >= previous) return 'Each price tier must be cheaper than the price before it';
    previous = t.unit_price;
  }
  return null;
}

function parseWhole(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
}

/** The values to send, or the first problem to show. */
export function checkListing(f: ListingFields, today: string): { ok: ListingValues } | { error: string } {
  const name = f.name.trim();
  if (!name) return { error: 'Name is required.' };
  if (name.length > LISTING_NAME_MAX) return { error: `Name can have at most ${LISTING_NAME_MAX} characters.` };
  const price = parseWhole(f.price);
  if (price === null || price < 1 || price > LISTING_PRICE_MAX) {
    return { error: `Price must be a whole number of pesos from 1 to ${LISTING_PRICE_MAX.toLocaleString('en-PH')}.` };
  }
  const stock = parseWhole(f.stock);
  if (stock === null || stock > LISTING_STOCK_MAX) {
    return { error: `Stock must be a whole number from 0 to ${LISTING_STOCK_MAX.toLocaleString('en-PH')}.` };
  }
  const harvest = parseYmd(f.harvestDate);
  if (f.harvestDate.trim() && harvest === null) return { error: 'Harvest date must be a real date, like 2026-11-19.' };
  const best = parseYmd(f.bestBefore);
  if (f.bestBefore.trim() && best === null) return { error: 'Best-before date must be a real date, like 2026-11-26.' };
  const fresh = freshnessError(harvest, best, today);
  if (fresh) return { error: `${fresh}.` };

  const minRaw = (f.minOrderQty ?? '').trim();
  const minOrder = minRaw === '' ? 1 : parseWhole(minRaw);
  if (minOrder === null || minOrder < 1 || minOrder > LISTING_STOCK_MAX) {
    return { error: 'Minimum order must be a whole number of 1 or more.' };
  }
  const rows = (f.tiers ?? []).filter((t) => t.minQty.trim() !== '' || t.unitPrice.trim() !== '');
  if (rows.length > LISTING_TIERS_MAX) return { error: `A listing can have at most ${LISTING_TIERS_MAX} bulk prices.` };
  const tiers: PriceTier[] = [];
  for (const row of rows) {
    const q = parseWhole(row.minQty);
    const p = parseWhole(row.unitPrice);
    if (q === null || q < 2 || q > LISTING_STOCK_MAX) return { error: 'Each bulk price needs a quantity of 2 or more.' };
    if (p === null || p < 1 || p > LISTING_PRICE_MAX) return { error: 'Each bulk price needs a whole number of pesos.' };
    tiers.push({ min_qty: q, unit_price: p });
  }
  const pricing = pricingError(price, minOrder, tiers);
  if (pricing) return { error: `${pricing}.` };
  tiers.sort((a, b) => a.min_qty - b.min_qty);

  return {
    ok: {
      name, price, stock_quantity: stock, harvest_date: harvest as string, best_before: best as string,
      min_order_qty: minOrder, price_tiers: tiers,
    },
  };
}
