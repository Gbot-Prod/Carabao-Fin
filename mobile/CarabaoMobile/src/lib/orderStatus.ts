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
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Awaiting payment',
  processing: 'Preparing',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

// The buyer-facing progress timeline. `cancelled` is not a step.
export const ORDER_TIMELINE_STEPS: { status: Exclude<OrderStatus, 'cancelled'>; label: string }[] = [
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
