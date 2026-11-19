// CF-0109: the cart lives on the server (/carts/me), as on the web. The phone
// sends only produce_id + quantity (backend CartItemIn, extra fields refused);
// every other field of a line comes back from the server. Pure, for `npm test`.
import type { CartItem } from './CartContext';

/** A stored line as the API returns it (backend schemas/cart.py CartItem). */
export type ServerCartLine = {
  id: string;
  produce_id: number;
  merchant_id?: number | null;
  produce: string;
  unit: string;
  image?: string | null;
  farm?: string | null;
  price: number;
  quantity: number;
  min_order_qty?: number;
  stock_quantity?: number;
  delivery_fee?: number;
  // Why checkout would refuse this line now (CF-0052); null when it can be bought.
  unavailable_reason?: string | null;
};

// Same limits as backend schemas/cart.py.
export const MAX_CART_ITEMS = 50;
export const MAX_ITEM_QUANTITY = 10_000;

export function fromServerLine(line: ServerCartLine): CartItem {
  return {
    id: String(line.produce_id),
    produceId: line.produce_id,
    merchantId: line.merchant_id ?? null,
    farm: line.farm || 'Farm',
    produce: line.produce,
    unit: line.unit,
    price: line.price,
    quantity: line.quantity,
    deliveryFee: line.delivery_fee ?? null,
    minOrderQty: line.min_order_qty ?? 1,
    stockQuantity: line.stock_quantity ?? 0,
    unavailableReason: line.unavailable_reason ?? null,
  };
}

/** The PUT /carts/me body: one line per produce, whole quantities within the backend bounds. */
export function toServerItems(items: readonly CartItem[]): { produce_id: number; quantity: number }[] {
  const byProduce = new Map<number, number>();
  for (const item of items) {
    const q = Math.floor(item.quantity);
    if (!Number.isSafeInteger(item.produceId) || item.produceId <= 0 || !(q > 0)) continue;
    byProduce.set(item.produceId, Math.min(MAX_ITEM_QUANTITY, (byProduce.get(item.produceId) ?? 0) + q));
  }
  return [...byProduce].slice(0, MAX_CART_ITEMS).map(([produce_id, quantity]) => ({ produce_id, quantity }));
}

/** Lines that checkout would refuse now; checkout stays closed while there are any. */
export function checkoutBlockers(items: readonly CartItem[]): CartItem[] {
  return items.filter((i) => !!i.unavailableReason);
}

/** "Kale is no longer available" — the backend reason is written after the name. */
export function blockerText(item: CartItem): string {
  return `${item.produce} ${item.unavailableReason ?? ''}`.trim();
}
