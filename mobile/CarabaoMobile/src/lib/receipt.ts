// CF-0135 (M54): pure helpers for the buyer's receipt. The first four are a copy of
// web frontend/carabao-app/lib/receipt.ts (CF-0049); keep both in step.
// The server builds every amount (backend services/receipts.py); the phone only shows them.

/** Payment states that have a receipt (money landed, refunded or not). Same
 *  set as MONEY_RECEIVED_STATUSES in backend/app/services/order_status.py. */
export const WITH_RECEIPT: readonly string[] = ['paid', 'refund_pending', 'refunded'];

export function hasReceipt(status: string | null | undefined): boolean {
  return status != null && WITH_RECEIPT.includes(status);
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

// ---- mobile only below ----

/** The texts of the web receipt page, word for word. */
export const RECEIPT_TEXT = {
  unpaid: 'This order has no payment yet, so there is no receipt.',
  missing: 'Order not found.',
  error: 'The receipt could not be loaded.',
} as const;

export type ReceiptFailure = keyof typeof RECEIPT_TEXT;

/** Same mapping as the web page: 404 → not found, 409 → no payment yet, else a retry. */
export function receiptFailure(status: number | undefined): ReceiptFailure {
  if (status === 404) return 'missing';
  if (status === 409) return 'unpaid';
  return 'error';
}

export type ReceiptSummary = {
  subtotal: number;
  delivery_fee: number;
  discount?: number;
  voucher_code?: string | null;
  total: number;
};

/** The rows under the items, as on the web: Subtotal, Delivery, Voucher (only when used), Total paid. */
export function receiptSummaryRows(r: ReceiptSummary): { label: string; value: string; total?: boolean }[] {
  const rows: { label: string; value: string; total?: boolean }[] = [
    { label: 'Subtotal', value: receiptPeso(r.subtotal) },
    { label: 'Delivery', value: receiptPeso(r.delivery_fee) },
  ];
  if (r.discount) {
    rows.push({
      label: `Voucher${r.voucher_code ? ` (${r.voucher_code})` : ''}`,
      value: `−${receiptPeso(r.discount)}`,
    });
  }
  rows.push({ label: 'Total paid', value: receiptPeso(r.total), total: true });
  return rows;
}

export type ReceiptForText = ReceiptSummary & {
  receipt_number: string;
  order_id: number;
  payment_status: string;
  farm_name: string | null;
  lines: { name: string; unit: string | null; quantity: number; unit_price: number; line_total: number }[];
};

/** Plain text for the share sheet (the phone has no print dialog). No buyer address
 *  or phone number: the buyer picks where it goes, so it carries only what proves the sale. */
export function receiptShareText(r: ReceiptForText, paidAt: string): string {
  const out = [
    `Carabao receipt ${r.receipt_number}`,
    `Sold by: ${r.farm_name ?? '—'}`,
    `Paid: ${paidAt}`,
    '',
    ...r.lines.map(
      (l) => `${l.quantity} × ${l.name}${l.unit ? ` (${l.unit})` : ''} @ ${receiptPeso(l.unit_price)} = ${receiptPeso(l.line_total)}`,
    ),
    '',
    ...receiptSummaryRows(r).map((row) => `${row.label}: ${row.value}`),
  ];
  const note = refundNote(r.payment_status);
  if (note) out.push(note);
  out.push(`Order #${r.order_id}`);
  return out.join('\n');
}
