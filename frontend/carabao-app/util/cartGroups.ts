import { SERVICE_FEE } from '@/lib/constants';

// A cart can hold several merchants' produce (C1); checkout makes one order per
// merchant, each with that merchant's delivery fee. These groups mirror that split.

type GroupableItem = {
  id: string;
  farm: string;
  quantity: number;
  price: number;
  merchant_id?: number | null;
  delivery_fee?: number | null;
};

export type CartGroup<T extends GroupableItem> = {
  key: string;
  farm: string;
  merchantId: number | null;
  items: T[];
  subtotal: number;
  deliveryFee: number;
  total: number;
};

export function groupCartByMerchant<T extends GroupableItem>(items: T[]): CartGroup<T>[] {
  const groups = new Map<string, CartGroup<T>>();
  for (const item of items) {
    // Lines saved before the server tagged merchants fall back to the farm name.
    const key = item.merchant_id != null ? `m${item.merchant_id}` : `f${item.farm}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        farm: item.farm || 'Farm',
        merchantId: item.merchant_id ?? null,
        items: [],
        subtotal: 0,
        // The server's figure once the cart is saved; the standard fee until then.
        deliveryFee: item.delivery_fee ?? SERVICE_FEE,
        total: 0,
      };
      groups.set(key, group);
    }
    group.items.push(item);
    group.subtotal += item.quantity * item.price;
  }
  return [...groups.values()].map((g) => ({ ...g, total: g.subtotal + g.deliveryFee }));
}

export function cartTotals<T extends GroupableItem>(groups: CartGroup<T>[]) {
  const itemTotal = groups.reduce((sum, g) => sum + g.subtotal, 0);
  const deliveryTotal = groups.reduce((sum, g) => sum + g.deliveryFee, 0);
  return { itemTotal, deliveryTotal, grandTotal: itemTotal + deliveryTotal };
}
