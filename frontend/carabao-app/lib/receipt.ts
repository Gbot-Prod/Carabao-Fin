// CF-0049 (B09): pure helpers for the printable receipt.
import type { PaymentStatus } from '@/util/api/statuses';

/** Payment states that have a receipt (money landed, refunded or not). Same
 *  set as MONEY_RECEIVED_STATUSES in backend/app/services/order_status.py. */
const WITH_RECEIPT: ReadonlySet<string> = new Set(['paid', 'refund_pending', 'refunded']);

export function hasReceipt(status: PaymentStatus | string | null | undefined): boolean {
  return status != null && WITH_RECEIPT.has(status);
}

/** ₱1,234 with no decimals (all amounts are whole pesos). */
export function receiptPeso(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return `₱${n.toLocaleString('en-PH')}`;
}

/** A note under the total when the money went back to the buyer. */
export function refundNote(status: string): string | null {
  if (status === 'refunded') return 'This payment was refunded.';
  if (status === 'refund_pending') return 'A refund for this payment is in progress.';
  return null;
}

/** Last 6 characters of a payment reference, enough to match a bank record. */
export function shortReference(ref: string | null | undefined): string | null {
  if (!ref) return null;
  return ref.length > 10 ? `…${ref.slice(-6)}` : ref;
}
