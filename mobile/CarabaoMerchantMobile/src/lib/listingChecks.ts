// Guardrails Phase 1: the backend listing checker (services/listing_checks.py) on the
// listing form. The form asks POST /produce/check while the merchant types; the save
// runs the same checks again. Same idea as the web lib/listing-checks.ts. Pure, for
// `npm test`.
import type { ListingField, ListingFieldErrors, TierFields } from './listingForm.ts';

export type ListingIssue = { field: string; code: string; message: string; suggestion?: string | null };
export type ProduceStatus = 'live' | 'under_review' | 'rejected' | 'hidden';
export type ProduceCheckResult = {
  valid: boolean;
  has_hard_blocks: boolean;
  has_soft_flags: boolean;
  recommended_status: ProduceStatus;
  hard_blocks: ListingIssue[];
  soft_flags: ListingIssue[];
  // Phase 4: the NCR market price for the produce, or null (no usable reference row).
  market_price?: MarketPrice | null;
};

/** Backend MarketPriceView: the NCR retail price; the form recommends `recommended_max` or less. */
export type MarketPrice = {
  commodity: string;
  low: number;
  high: number;
  unit: string;
  source: string;
  as_of: string; // YYYY-MM-DD
  recommended_max: number;
  price_per_kg: number | null;
};

const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;

/**
 * The lines under the price field. Buyers expect a farm price below the NCR market
 * price, so the note recommends the low end or less. Information only: the save never
 * refuses a price for this.
 */
export function marketPriceNote(market: MarketPrice | null | undefined): { range: string; advice: string } | null {
  if (!market) return null;
  const range = `NCR market price for ${market.commodity}: ${peso(market.low)}–${peso(market.high)} / ${market.unit} (${market.source}, ${market.as_of}).`;
  const recommended = `${peso(market.recommended_max)} / ${market.unit}`;
  const perKg = market.price_per_kg;
  let advice = `Recommended: ${recommended} or less. Buyers expect a farm price below the NCR market price.`;
  if (perKg != null && perKg > market.high) {
    advice = `Your price is ${peso(perKg)} / kg, above the NCR market price. Recommended: ${recommended} or less.`;
  } else if (perKg != null && perKg > market.recommended_max) {
    advice = `Your price is ${peso(perKg)} / kg, in the NCR market range. Recommended: ${recommended} or less.`;
  } else if (perKg != null) {
    advice = `Your price is ${peso(perKg)} / kg, below the NCR market price.`;
  }
  return { range, advice };
}

/** The wait after the last key press before the form is checked (web: the same). */
export const CHECK_DELAY_MS = 400;

// Backend field -> this form's control. `category` and `description` have no text
// field with a message slot here, so their messages show at the top.
const FORM_FIELDS: Record<string, ListingField> = {
  name: 'name',
  price: 'price',
  stock_quantity: 'stock',
  harvest_date: 'harvestDate',
  best_before: 'bestBefore',
  min_order_qty: 'minOrderQty',
  price_tiers: 'tiers',
};

export type CheckNotes = {
  /** Hard blocks per field: the save would be refused. */
  blocks: ListingFieldErrors;
  /** Soft flags per field: the listing goes to an admin. */
  flags: ListingFieldErrors;
  /** Messages with no field on this form (category, description, unit ...). */
  topBlocks: string[];
  topFlags: string[];
  /** CATEGORY_MISMATCH: the category the checker suggests. */
  categorySuggestion: 'Vegetables' | 'Fruits' | null;
};

function put(target: ListingFieldErrors, field: ListingField, text: string) {
  const shown = target[field];
  target[field] = shown && !shown.includes(text) ? `${shown} ${text}` : text;
}

export function checkNotes(result: ProduceCheckResult | null): CheckNotes {
  const notes: CheckNotes = { blocks: {}, flags: {}, topBlocks: [], topFlags: [], categorySuggestion: null };
  for (const issue of result?.hard_blocks ?? []) {
    const field = FORM_FIELDS[issue.field];
    if (field) put(notes.blocks, field, issue.message);
    else if (!notes.topBlocks.includes(issue.message)) notes.topBlocks.push(issue.message);
  }
  for (const issue of result?.soft_flags ?? []) {
    const field = FORM_FIELDS[issue.field];
    if (field) put(notes.flags, field, issue.message);
    else if (!notes.topFlags.includes(issue.message)) notes.topFlags.push(issue.message);
    if (issue.suggestion === 'Vegetables' || issue.suggestion === 'Fruits') {
      notes.categorySuggestion = issue.suggestion;
    }
  }
  return notes;
}

export function hasBlocks(notes: CheckNotes): boolean {
  return notes.topBlocks.length > 0 || Object.keys(notes.blocks).length > 0;
}

/** What the form sends to POST /produce/check. Blank or half-typed values are left out. */
export function checkPayload(
  f: {
    name: string; price: string; stock: string; harvestDate: string; bestBefore: string;
    minOrderQty: string; tiers: TierFields[]; unit: 'kg'; category: 'Vegetables' | 'Fruits' | null;
    unitQuantity?: number | null;
  },
  produceId: number | null,
) {
  const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
  const ymd = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);
  const price = whole(f.price);
  const minOrder = whole(f.minOrderQty);
  return {
    produce_id: produceId,
    name: f.name.trim() || null,
    category: f.category,
    unit: f.unit,
    unit_quantity: f.unitQuantity && f.unitQuantity > 0 ? f.unitQuantity : null,
    price: price !== null && price >= 1 && price <= 1_000_000 ? price : null,
    stock_quantity: whole(f.stock),
    harvest_date: ymd(f.harvestDate),
    best_before: ymd(f.bestBefore),
    min_order_qty: minOrder !== null && minOrder >= 1 ? minOrder : null,
    price_tiers: f.tiers
      .map((t) => ({ min_qty: whole(t.minQty), unit_price: whole(t.unitPrice) }))
      .filter((t): t is { min_qty: number; unit_price: number } =>
        t.min_qty !== null && t.min_qty >= 2 && t.unit_price !== null && t.unit_price >= 1)
      .slice(0, 5),
  };
}

/** The line a merchant's own listing shows about its review state. */
export function reviewNote(p: { status?: ProduceStatus; rejection_reason?: string | null }): string | null {
  if (p.status === 'under_review') {
    return 'Under review: an admin checks it within 24 hours. Buyers can still see and order it.';
  }
  if (p.status === 'rejected') {
    const reason = p.rejection_reason?.trim();
    return `Not approved${reason ? `: ${reason}` : '.'} Buyers cannot see it. Edit and save it to send it again.`;
  }
  return null;
}

// Guardrails Phase 2 (backend services/listing_trust.py, GET /merchants/me/listing-standing).
export type ListingPenalty = {
  id: number;
  produce_id: number | null;
  produce_name: string;
  code: string;
  label: string;
  points: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
};
export type ListingStanding = {
  points: number;
  window_days: number;
  listing_block_points: number;
  account_review_points: number;
  can_create_listings: boolean;
  blocked_until: string | null;
  new_merchant_reviews_left: number;
  penalties: ListingPenalty[];
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export type StandingNote = { tone: 'info' | 'warning' | 'blocked'; lines: string[] };

/** What the listings screen says about penalty points and the new-farm review (web: the same). */
export function standingNote(s: ListingStanding | null): StandingNote | null {
  if (!s) return null;
  const lines: string[] = [];
  if (s.points > 0) {
    lines.push(
      `You have ${s.points} penalty point${s.points === 1 ? '' : 's'} (from listings an admin did not approve in the last ${s.window_days} days).`,
    );
    for (const p of s.penalties) {
      lines.push(`${p.produce_name}: ${p.label} ${p.points} point${p.points === 1 ? '' : 's'}, until ${shortDate(p.expires_at)}.`);
    }
  }
  if (!s.can_create_listings) {
    lines.push(
      `You cannot make new listings${s.blocked_until ? ` until ${shortDate(s.blocked_until)}` : ''}. You can still edit your current listings.`,
    );
  } else if (s.points > 0) {
    lines.push(`At ${s.listing_block_points} points you cannot make new listings.`);
  }
  if (s.new_merchant_reviews_left > 0) {
    lines.push(
      `New farm: an admin checks your listings until ${s.new_merchant_reviews_left} more ${s.new_merchant_reviews_left === 1 ? 'is' : 'are'} approved. Buyers can see them during the check.`,
    );
  }
  if (lines.length === 0) return null;
  const tone = !s.can_create_listings ? 'blocked' : s.points > 0 ? 'warning' : 'info';
  return { tone, lines };
}
