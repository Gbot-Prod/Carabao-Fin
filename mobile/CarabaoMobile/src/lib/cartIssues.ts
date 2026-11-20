// CF-0129: cart line problems the API reports (GET/PUT /carts/me `issue`,
// CF-0042). Ported from web `frontend/carabao-app/lib/cart-issues.ts`; the
// texts are the web English strings (`lib/i18n/strings/en.ts` cart.issue*).
// Keep both sides in step. Pure, so `npm test` runs it. Every issue blocks
// checkout: place-order would refuse the whole cart.

/** Same codes as backend `_order_helpers.py` CartIssue. */
export const CART_ISSUES = [
  'unavailable',
  'expired',
  'farm_unavailable',
  'own_listing',
  'below_minimum',
  'exceeds_stock',
] as const;

export type CartIssue = (typeof CART_ISSUES)[number];

const TEXT: Record<CartIssue, string> = {
  unavailable: 'No longer available. Remove it to continue.',
  expired: 'Past its best-before date. Remove it to continue.',
  farm_unavailable: 'This farm is not taking orders now. Remove it to continue.',
  own_listing: 'This is from your own farm. Remove it to continue.',
  below_minimum: 'Below the minimum order of {qty}. Raise the quantity to continue.',
  exceeds_stock: 'Only {qty} left. Lower the quantity to continue.',
};

type IssueLine = {
  issue?: string | null;
  minOrderQty?: number;
  stockQuantity?: number;
};

/** A code from the server, or null when it is missing or this build does not know it. */
export function parseCartIssue(value: unknown): CartIssue | null {
  return typeof value === 'string' && (CART_ISSUES as readonly string[]).includes(value)
    ? (value as CartIssue)
    : null;
}

/** The message for a line's issue, with {qty} filled in; null when none or unknown. */
export function cartIssueMessage(line: IssueLine): string | null {
  const issue = parseCartIssue(line.issue);
  if (!issue) return null;
  const qty =
    issue === 'below_minimum' ? (line.minOrderQty ?? 1) : issue === 'exceeds_stock' ? (line.stockQuantity ?? 0) : '';
  return TEXT[issue].replace('{qty}', String(qty));
}

/** "Price changed from ₱120." when the listing price moved since the buyer last saved the line. */
export function priceChangeText(line: { price: number; previousPrice?: number | null }): string | null {
  const old = line.previousPrice;
  if (old == null || !Number.isFinite(old) || old === line.price) return null;
  return `Price changed from ₱${old.toLocaleString()}.`;
}

/** "+" stops at the stock the server reported, as on the web cart; unknown stock does not cap. */
export function atStockCap(line: { quantity: number; stockQuantity?: number }): boolean {
  return line.stockQuantity !== undefined && line.quantity >= line.stockQuantity;
}
