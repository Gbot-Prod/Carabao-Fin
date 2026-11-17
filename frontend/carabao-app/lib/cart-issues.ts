// CF-0042: cart line problems the API reports (GET/PUT /carts/me `issue`).
// Pure, so `npm test` runs it. Every issue blocks checkout: place-order would
// refuse the whole cart.

export type CartIssue =
  | 'unavailable'
  | 'expired'
  | 'farm_unavailable'
  | 'own_listing'
  | 'below_minimum'
  | 'exceeds_stock';

export type CartIssueStrings = {
  issueUnavailable: string;
  issueExpired: string;
  issueFarmUnavailable: string;
  issueOwnListing: string;
  issueBelowMinimum: string;
  issueExceedsStock: string;
};

type IssueLine = {
  issue?: CartIssue | null;
  min_order_qty?: number;
  stock_quantity?: number;
};

const KEY: Record<CartIssue, keyof CartIssueStrings> = {
  unavailable: 'issueUnavailable',
  expired: 'issueExpired',
  farm_unavailable: 'issueFarmUnavailable',
  own_listing: 'issueOwnListing',
  below_minimum: 'issueBelowMinimum',
  exceeds_stock: 'issueExceedsStock',
};

/** The message for a line's issue, with {qty} filled in; null when none or unknown. */
export function cartIssueMessage(line: IssueLine, strings: CartIssueStrings): string | null {
  if (!line.issue) return null;
  const key = KEY[line.issue];
  if (!key) return null;
  const qty =
    line.issue === 'below_minimum' ? (line.min_order_qty ?? 1) : line.issue === 'exceeds_stock' ? (line.stock_quantity ?? 0) : '';
  return strings[key].replace('{qty}', String(qty));
}

/** Lines that would make place-order refuse the cart. */
export function blockingLineCount(lines: readonly IssueLine[]): number {
  return lines.filter((l) => Boolean(l.issue)).length;
}
