import { apiClient } from './client';

export type CartItem = {
  // str(produce_id); rows are keyed on it.
  id: string;
  produce_id?: number;
  image?: string | null;
  farm: string;
  produce: string;
  unit: string;
  quantity: number;
  price: number;
  stock_quantity?: number;
  // Set by the server when the cart is saved.
  min_order_qty?: number;
  merchant_id?: number | null;
  delivery_fee?: number | null;
};

export type Cart = {
  id: number;
  user_id: number;
  items: CartItem[];
  total_items: number;
  total_price: number;
};

export const fetchMyCart = async (): Promise<Cart> => {
  const response = await apiClient.get<Cart>('/carts/me');
  return response.data;
};

// The server builds each line (name, price, farm, fees) from the listing and
// refuses any other field, so only produce_id and quantity are sent (CF-0008).
export const replaceMyCart = async (items: CartItem[]): Promise<Cart> => {
  const response = await apiClient.put<Cart>('/carts/me', {
    items: items.map((item) => ({
      produce_id: Number(item.produce_id ?? item.id),
      quantity: item.quantity,
    })),
  });
  return response.data;
};
