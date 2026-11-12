import { apiClient } from './client';

export type CartItem = {
  id: string;
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

export const replaceMyCart = async (items: CartItem[]): Promise<Cart> => {
  const response = await apiClient.put<Cart>('/carts/me', { items });
  return response.data;
};
