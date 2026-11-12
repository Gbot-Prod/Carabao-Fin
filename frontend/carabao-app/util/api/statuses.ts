// Mirrors backend/app/models/statuses.py. The backend enforces these values
// (DB CHECK constraints + API validation); keep both files in step.

export const ORDER_STATUSES = [
  'pending', // placed, awaiting payment
  'processing', // paid; merchant is preparing it
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// One checkout attempt's money.
export type TransactionStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'refund_pending'
  | 'refunded';

// An order's payment state, derived on the backend from its transactions.
export type PaymentStatus =
  | 'awaiting_payment'
  | 'paid'
  | 'refund_pending'
  | 'refunded'
  | 'unpaid';

export type PayoutStatus = 'pending' | 'approved' | 'processing' | 'released' | 'failed';

export const IN_TRANSIT_ORDER_STATUSES: readonly OrderStatus[] = ['shipped', 'out_for_delivery'];
export const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = ['delivered', 'cancelled'];

export const isInTransit = (status: OrderStatus) => IN_TRANSIT_ORDER_STATUSES.includes(status);
export const isClosed = (status: OrderStatus) => CLOSED_ORDER_STATUSES.includes(status);

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Awaiting payment',
  processing: 'Preparing',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
  unpaid: 'Not paid',
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: 'Checkout open',
  paid: 'Paid',
  failed: 'Failed',
  expired: 'Expired',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
};

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  pending: 'Requested',
  approved: 'Approved',
  processing: 'Processing',
  released: 'Released',
  failed: 'Failed',
};
