// S7 (plan §5.8): the rules behind the Inventory screen, copied from the web merchant
// inventory page (M/(shell)/inventory/page.tsx), StockAlertsPanel.tsx and DemandInsight.tsx.
// Pure, for `npm test`.
//
// The low-stock, best-before and expired groups are ranked by the server
// (backend app/api/routes/stock_alerts.py), so the screen draws them as they come.
// These helpers choose the order of the "Stock by produce" rows exactly as the web
// table does, check the threshold box (web rule, backend cap) and the stock box
// (listingForm bounds), and step stock by one without leaving 0..LISTING_STOCK_MAX.
import { LISTING_STOCK_MAX } from './listingForm.ts';

/** The threshold until the farm sets its own: backend `threshold = 5`, web `useState(5)`. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
/** Backend ThresholdUpdate: `Field(ge=0, le=100_000)`; 0 turns low-stock alerts off. */
export const LOW_STOCK_THRESHOLD_MIN = 0;
export const LOW_STOCK_THRESHOLD_MAX = 100_000;

/** One row of the stock table: what the totals and the sort need. */
export type StockRow = { name: string | null; price: number; stock_quantity: number };

/** 'out' | 'low' | 'ok', the three badges the web table draws. */
export type StockStatus = 'out' | 'low' | 'ok';

/**
 * The web page's `isLow`: a listing on sale at or below the threshold. Stock 0 is out of
 * stock, not low, and a threshold of 0 turns the flag off (backend stock_alerts.py skips
 * the group then too).
 */
export function isLowStock(quantity: number, threshold: number): boolean {
  return quantity > 0 && threshold > 0 && quantity <= threshold;
}

/** Out of stock first, then low, then the rest — the web table's status column. */
export function stockStatus(quantity: number, threshold: number): StockStatus {
  if (quantity === 0) return 'out';
  return isLowStock(quantity, threshold) ? 'low' : 'ok';
}

/** The badge words the web table prints. */
export function stockStatusLabel(status: StockStatus): string {
  return status === 'out' ? 'Out of Stock' : status === 'low' ? 'Low Stock' : 'In Stock';
}

/**
 * The web table's order: out of stock first, then low stock, then the rest by name.
 * A copy, so the shared produce list is never re-ordered by a screen.
 */
export function sortStock<T extends Pick<StockRow, 'name' | 'stock_quantity'>>(
  rows: readonly T[],
  threshold: number,
): T[] {
  const rank = (quantity: number) => (quantity === 0 ? 0 : isLowStock(quantity, threshold) ? 1 : 2);
  return [...rows].sort(
    (a, b) =>
      rank(a.stock_quantity) - rank(b.stock_quantity) ||
      (a.name ?? '').localeCompare(b.name ?? ''),
  );
}

/** The three number tiles: price × stock, listings with none left, listings at or below the threshold. */
export function inventoryTotals(
  rows: readonly StockRow[],
  threshold: number,
): { value: number; outOfStock: number; lowStock: number } {
  return rows.reduce(
    (acc, r) => ({
      value: acc.value + r.price * r.stock_quantity,
      outOfStock: acc.outOfStock + (r.stock_quantity === 0 ? 1 : 0),
      lowStock: acc.lowStock + (isLowStock(r.stock_quantity, threshold) ? 1 : 0),
    }),
    { value: 0, outOfStock: 0, lowStock: 0 },
  );
}

/**
 * Why the threshold box cannot be saved, or null. The web's own rule first ("Enter a
 * whole number, 0 or more."), then the backend's upper bound, which the web form leaves
 * to the server (a 422 with a message that names no field).
 */
export function thresholdProblem(draft: string): string | null {
  const value = draft.trim();
  if (!/^\d+$/.test(value)) return 'Enter a whole number, 0 or more.';
  if (Number(value) > LOW_STOCK_THRESHOLD_MAX) {
    return `Enter ${LOW_STOCK_THRESHOLD_MAX.toLocaleString('en-PH')} or less.`;
  }
  return null;
}

/** The stock the edit box can save: the same whole-number bounds as the listing form. */
export function stockProblem(draft: string): string | null {
  const value = draft.trim();
  if (!/^\d+$/.test(value) || Number(value) > LISTING_STOCK_MAX) {
    return `Stock must be a whole number from 0 to ${LISTING_STOCK_MAX.toLocaleString('en-PH')}.`;
  }
  return null;
}

/** The stock one +/− tap sets: whole, never below 0, never above the backend's maximum. */
export function stepStock(stock: number, delta: number): number {
  const current = Number.isFinite(stock) ? Math.round(stock) : 0;
  return Math.min(LISTING_STOCK_MAX, Math.max(0, current + delta));
}

/** The web panel's day wording: "today", "tomorrow", "in 3 days"; blank with no date. */
export function daysLabel(days: number | null): string {
  return days == null ? '' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}
