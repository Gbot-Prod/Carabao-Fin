// CF-0107: checks for the listing create/edit form. Pure, for `npm test`.
// Same rules and messages as the backend: schemas/produce.py (bounds) and
// services/produce_freshness.py freshness_error (dates, in Philippine time).

export const LISTING_NAME_MAX = 100; // backend MAX_NAME
export const LISTING_PRICE_MAX = 1_000_000; // backend MAX_PRICE
export const LISTING_STOCK_MAX = 10_000_000; // backend MAX_STOCK

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

export type ListingFields = {
  name: string;
  price: string;
  stock: string;
  harvestDate: string;
  bestBefore: string;
};

export type ListingValues = {
  name: string;
  price: number;
  stock_quantity: number;
  harvest_date: string;
  best_before: string;
};

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
  return { ok: { name, price, stock_quantity: stock, harvest_date: harvest as string, best_before: best as string } };
}
