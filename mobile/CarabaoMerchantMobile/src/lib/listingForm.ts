// CF-0107: checks for the listing create/edit form. Pure, for `npm test`.
// Same rules and messages as the backend: schemas/produce.py (bounds) and
// services/produce_freshness.py freshness_error (dates, in Philippine time).

export const LISTING_NAME_MAX = 100; // backend MAX_NAME
export const LISTING_PRICE_MAX = 1_000_000; // backend MAX_PRICE
export const LISTING_PRICE_PER_KG_MAX = 500; // backend listing_checks.MAX_PRICE_PER_KG
export const LISTING_STOCK_MAX = 10_000_000; // backend MAX_STOCK
export const LISTING_TIERS_MAX = 5; // backend MAX_PRICE_TIERS (CF-0116)

// The date helpers live in ./dates.ts, a copy the buyer app has too (its checkout
// uses them); re-exported so this module keeps its old API.
export { addDays, phToday } from './dates.ts';

/** A real calendar date written as YYYY-MM-DD, else null ("2026-02-30" is null). */
export function parseYmd(value: string): string | null {
  const v = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v ? v : null;
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
  /** Kg in one sale unit (the listing's unit_quantity). Blank = 1. */
  unitQuantity?: number | null;
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

/** The values to send, or the first problem to show under its own field (rule 8). */
export function checkListing(f: ListingFields, today: string): { ok: ListingValues } | { error: string; field: ListingField } {
  const name = f.name.trim();
  if (!name) return { error: 'Name is required.', field: 'name' };
  if (name.length > LISTING_NAME_MAX) return { error: `Name can have at most ${LISTING_NAME_MAX} characters.`, field: 'name' };
  const price = parseWhole(f.price);
  if (price === null || price < 1 || price > LISTING_PRICE_MAX) {
    return {
      error: `Price must be a whole number of pesos from 1 to ${LISTING_PRICE_MAX.toLocaleString('en-PH')}.`,
      field: 'price',
    };
  }
  const kg = f.unitQuantity && f.unitQuantity > 0 ? f.unitQuantity : 1;
  if (price / kg > LISTING_PRICE_PER_KG_MAX) {
    return { error: `The price can be at most ${LISTING_PRICE_PER_KG_MAX} pesos per kg.`, field: 'price' };
  }
  const stock = parseWhole(f.stock);
  if (stock === null || stock > LISTING_STOCK_MAX) {
    return {
      error: `Stock must be a whole number from 0 to ${LISTING_STOCK_MAX.toLocaleString('en-PH')}.`,
      field: 'stock',
    };
  }
  const harvest = parseYmd(f.harvestDate);
  if (f.harvestDate.trim() && harvest === null) {
    return { error: 'Harvest date must be a real date, like 2026-11-19.', field: 'harvestDate' };
  }
  const best = parseYmd(f.bestBefore);
  if (f.bestBefore.trim() && best === null) {
    return { error: 'Best-before date must be a real date, like 2026-11-26.', field: 'bestBefore' };
  }
  const fresh = freshnessError(harvest, best, today);
  if (fresh) {
    // The missing or future harvest date first; otherwise the best-before date.
    const field: ListingField = harvest === null || harvest > today ? 'harvestDate' : 'bestBefore';
    return { error: `${fresh}.`, field };
  }

  const minRaw = (f.minOrderQty ?? '').trim();
  const minOrder = minRaw === '' ? 1 : parseWhole(minRaw);
  if (minOrder === null || minOrder < 1 || minOrder > LISTING_STOCK_MAX) {
    return { error: 'Minimum order must be a whole number of 1 or more.', field: 'minOrderQty' };
  }
  const rows = (f.tiers ?? []).filter((t) => t.minQty.trim() !== '' || t.unitPrice.trim() !== '');
  if (rows.length > LISTING_TIERS_MAX) {
    return { error: `A listing can have at most ${LISTING_TIERS_MAX} bulk prices.`, field: 'tiers' };
  }
  const tiers: PriceTier[] = [];
  for (const row of rows) {
    const q = parseWhole(row.minQty);
    const p = parseWhole(row.unitPrice);
    if (q === null || q < 2 || q > LISTING_STOCK_MAX) {
      return { error: 'Each bulk price needs a quantity of 2 or more.', field: 'tiers' };
    }
    if (p === null || p < 1 || p > LISTING_PRICE_MAX) {
      return { error: 'Each bulk price needs a whole number of pesos.', field: 'tiers' };
    }
    tiers.push({ min_qty: q, unit_price: p });
  }
  const pricing = pricingError(price, minOrder, tiers);
  if (pricing) return { error: `${pricing}.`, field: 'tiers' };
  tiers.sort((a, b) => a.min_qty - b.min_qty);

  return {
    ok: {
      name, price, stock_quantity: stock, harvest_date: harvest as string, best_before: best as string,
      min_order_qty: minOrder, price_tiers: tiers,
    },
  };
}

// ── S6: server messages on the form's fields (plan rule 8) ─────────────────────

/** A photo chosen in the listing form, before it is uploaded (S6). */
export type PickedPhoto = {
  /** The picker's local URI (file:// or content://): shown directly, never from the server. */
  uri: string;
  name?: string | null;
  mimeType?: string | null;
};

/** The controls this form has, as the screen and the form name them. */
export type ListingField =
  | 'name' | 'price' | 'stock' | 'harvestDate' | 'bestBefore' | 'minOrderQty' | 'tiers' | 'photo';

/** One message under each of the form's fields. */
export type ListingFieldErrors = Partial<Record<ListingField, string>>;

// The backend names (schemas/produce.py, and the upload's multipart part) -> the field
// that shows the message. Fields left out here (description, unit, category) have no
// control on this form, so their message goes to the top instead of being lost.
const SERVER_FIELDS: Record<string, ListingField> = {
  name: 'name',
  price: 'price',
  stock_quantity: 'stock',
  harvest_date: 'harvestDate',
  best_before: 'bestBefore',
  min_order_qty: 'minOrderQty',
  price_tiers: 'tiers',
  // The photo: the upload part (web uploadProduceImage) and the JSON field it fills.
  image: 'photo',
  image_url: 'photo',
};

export type ListingSaveErrors = {
  /** Messages for the fields the form has; each shows under its field. */
  fields: ListingFieldErrors;
  /** Shown at the top: a network/5xx message, or a server field the form has no control for. */
  top: string | null;
};

/**
 * Rule 8: a server message for a field this form has goes under that field; only a
 * message it cannot place (no field at all, or a field such as `unit`) shows at the top.
 * The backend's FieldErrors detail is just its field messages joined, and a 422's detail
 * is the same lines (core/errors.py, apiErrors.ts), so nothing is lost either way.
 */
export function listingSaveErrors(
  message: string | null | undefined,
  serverFields: Record<string, string> = {},
): ListingSaveErrors {
  const fields: ListingFieldErrors = {};
  const unplaced: string[] = [];
  for (const [key, raw] of Object.entries(serverFields)) {
    const text = raw.trim();
    if (!text) continue;
    const field = SERVER_FIELDS[key];
    if (!field) {
      if (!unplaced.includes(text)) unplaced.push(text);
      continue;
    }
    const shown = fields[field];
    fields[field] = shown && shown !== text ? `${shown} ${text}` : text;
  }
  const placed = Object.keys(fields).length > 0;
  const top = unplaced.length ? unplaced.join('\n') : placed ? null : message?.trim() || null;
  return { fields, top };
}
