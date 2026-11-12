// A cart can hold several farms' produce (C1); checkout makes one order per farm,
// each with that farm's delivery fee. Mirrors frontend util/cartGroups.ts.
import type { CartItem } from './CartContext';

// Used only for a line added before the farm's fee was known.
export const DEFAULT_DELIVERY_FEE = 40;

export type CartGroup = {
  key: string;
  farm: string;
  merchantId: number | null;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
};

export function groupCartByFarm(items: CartItem[]): CartGroup[] {
  const groups = new Map<string, CartGroup>();
  for (const item of items) {
    const key = item.merchantId != null ? `m${item.merchantId}` : `f${item.farm}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        farm: item.farm || 'Farm',
        merchantId: item.merchantId,
        items: [],
        subtotal: 0,
        deliveryFee: item.deliveryFee ?? DEFAULT_DELIVERY_FEE,
        total: 0,
      };
      groups.set(key, group);
    }
    group.items.push(item);
    group.subtotal += item.price * item.quantity;
  }
  return [...groups.values()].map((g) => ({ ...g, total: g.subtotal + g.deliveryFee }));
}

export function cartTotals(groups: CartGroup[]) {
  const itemTotal = groups.reduce((sum, g) => sum + g.subtotal, 0);
  const deliveryTotal = groups.reduce((sum, g) => sum + g.deliveryFee, 0);
  return { itemTotal, deliveryTotal, grandTotal: itemTotal + deliveryTotal };
}

// Orders still to pay after a multi-farm checkout, passed to the confirmation screen.
export type PendingOrder = { id: number; ref: string; farm: string; total: number };

export function parsePendingOrders(raw: string | undefined): PendingOrder[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as PendingOrder[]).filter((o) => Number.isFinite(o?.id))
      : [];
  } catch {
    return [];
  }
}
