import { apiClient } from './client';

export type CartItem = {
  id: string;
  farm: string;
  produce: string;
  unit: string;
  quantity: number;
  price: number;
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
