// Shared with mobile/CarabaoMobile/src/lib/orderStatus.ts. Keep both copies the same (sharedCopies.test.ts).
// src/lib/orderStatus.ts
// Raw order statuses as the API returns them (backend/app/models/statuses.py),
// with the same labels the web uses (frontend/carabao-app/util/api/statuses.ts).

export const ORDER_STATUSES = [
  'pending', // placed, awaiting payment
  'processing', // paid; merchant is preparing it
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'payment_mismatch', // paid the wrong amount; refunded, never processed (CF-0005)
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Finished orders: nothing changes after these (web statuses.ts CLOSED_ORDER_STATUSES). */
export const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = ['delivered', 'cancelled', 'payment_mismatch'];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Awaiting payment',
  processing: 'Preparing',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  payment_mismatch: 'Payment problem',
};

// The buyer-facing progress timeline. `cancelled` and `payment_mismatch` are not steps.
export const ORDER_TIMELINE_STEPS: {
  status: Exclude<OrderStatus, 'cancelled' | 'payment_mismatch'>;
  label: string;
}[] = [
  { status: 'pending', label: 'Order Placed' },
  { status: 'processing', label: 'Processing' },
  { status: 'shipped', label: 'Shipped' },
  { status: 'out_for_delivery', label: 'Out for Delivery' },
  { status: 'delivered', label: 'Delivered' },
];

export type StatusColor = 'green' | 'blue' | 'yellow' | 'gray';

export function isOrderStatus(s: string): s is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(s);
}

export function orderStatusLabel(s: string): string {
  if (isOrderStatus(s)) return ORDER_STATUS_LABELS[s];
  // Unknown value: show it readably rather than as snake_case.
  const words = s.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function orderStatusColor(s: string): StatusColor {
  if (s === 'delivered') return 'green';
  if (s === 'shipped' || s === 'out_for_delivery') return 'blue';
  if (s === 'processing') return 'yellow';
  return 'gray';
}

// Index into ORDER_TIMELINE_STEPS, or -1 for cancelled/unknown statuses.
export function timelineIndex(s: string): number {
  return ORDER_TIMELINE_STEPS.findIndex((step) => step.status === s);
}
