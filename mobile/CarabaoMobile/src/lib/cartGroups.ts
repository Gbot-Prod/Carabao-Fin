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

// CF-0114: this list arrives as a route parameter, which a deep link can set. Only
// well-formed rows are kept, so a crafted link cannot show made-up farms or amounts.
// (What is charged always comes from the server's checkout for that order id.)
const MAX_PENDING = 20;
const MAX_TOTAL = 10_000_000;

function isPendingOrder(o: unknown): o is PendingOrder {
  if (typeof o !== 'object' || o === null) return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.id === 'number' && Number.isSafeInteger(r.id) && r.id > 0 &&
    typeof r.ref === 'string' && /^CB-(\d{4}|XXXX)-\d{4,10}$/.test(r.ref) &&
    typeof r.farm === 'string' && r.farm.trim().length > 0 && r.farm.length <= 100 &&
    typeof r.total === 'number' && Number.isInteger(r.total) && r.total >= 0 && r.total <= MAX_TOTAL
  );
}

export function parsePendingOrders(raw: string | undefined): PendingOrder[] {
  if (!raw || raw.length > 10_000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isPendingOrder).slice(0, MAX_PENDING).map((o) => ({ id: o.id, ref: o.ref, farm: o.farm.trim(), total: o.total }))
      : [];
  } catch {
    return [];
  }
}
