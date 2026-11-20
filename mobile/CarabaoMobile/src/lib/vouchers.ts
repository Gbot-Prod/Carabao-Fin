// CF-0131: farm voucher code at checkout (M52, web B70).
// `CODE_PATTERN` and `normalizeBuyerCode` are copied from web lib/vouchers.ts
// (same as backend services/vouchers.CODE_PATTERN); inStep.test.ts checks both.
// The discount always comes from the server (POST /orders/me/voucher-preview);
// place-order checks the code again and works out the real discount.

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
// backend schemas/order.py VoucherPreviewRequest / PlaceOrderRequest voucher_code.
export const VOUCHER_CODE_MAX = 40;

// Texts word for word from web lib/i18n/strings/en.ts (checkout.voucher*).
export const VOUCHER_TEXT = {
  label: 'Farm voucher code',
  apply: 'Apply',
  checking: 'Checking…',
  remove: 'Remove',
  badCode: 'Enter the code as it was given: letters, digits or "-".',
  error: 'This voucher could not be checked. Try again.',
} as const;

export type VoucherPreview = {
  code: string;
  merchant_id: number;
  merchant_name: string;
  discount: number;
};

/** A buyer's typed code, trimmed and upper-cased, or null if it can't be one. */
export function normalizeBuyerCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** "SAVE10 applied: PHP 50.00 off Mang Ben Farm" (web checkout.voucherApplied). */
export function voucherAppliedText(v: VoucherPreview): string {
  return `${v.code} applied: PHP ${v.discount.toFixed(2)} off ${v.merchant_name}`;
}

/** "Voucher (SAVE10)" (web checkout.voucherDiscount). */
export function voucherDiscountLabel(v: Pick<VoucherPreview, 'code'>): string {
  return `Voucher (${v.code})`;
}

/**
 * The total shown before paying: the cart total less the server's preview
 * discount, never below 0 (same as web checkout `payable`). A bad or missing
 * discount counts as 0.
 */
export function payableAfterVoucher(grandTotal: number, v: Pick<VoucherPreview, 'discount'> | null): number {
  const d = v && Number.isFinite(v.discount) && v.discount > 0 ? v.discount : 0;
  return Math.max(grandTotal - d, 0);
}

/**
 * A key for the cart lines the preview was worked out on. When it changes, the
 * applied voucher is dropped so the buyer applies it again on the new cart.
 */
export function voucherCartKey(items: { produceId: number; quantity: number }[]): string {
  return items
    .map((i) => `${i.produceId}x${i.quantity}`)
    .sort()
    .join(',');
}
