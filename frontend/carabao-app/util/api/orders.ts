import { apiClient } from './client';
import type { CartItem } from './cart';

export type OrderHistoryItem = {
  id: number;
  order_id: number;
  merchant: string;
  merchant_id?: number | null;
  merchant_page_slug?: string | null;
  total_amount: number;
  order_date: string;
  status: string;
  items: CartItem[];
};

export type CurrentOrderItem = {
  id: number;
  order_id: number;
  merchant: string;
  merchant_id?: number | null;
  merchant_page_slug?: string | null;
  shipped: boolean;
  date_bought: string;
  time_of_arrival: string | null;
  delivery_fee: number;
  image: string | null;
  status: string;
  items: CartItem[];
};

export type PlaceOrderPayload = {
  delivery_date?: string | null;
  delivery_time?: string | null;
  delivery_address?: string | null;
  payment_method?: string | null;
  notes?: string | null;
  service_fee?: number;
  image?: string | null;
};

export type PlaceOrderResponse = {
  order_id: number;
  order_reference: string;
  status: string;
};

export const fetchOrderHistory = async (): Promise<OrderHistoryItem[]> => {
  const response = await apiClient.get<OrderHistoryItem[]>('/orders/me/history');
  return response.data;
};

export const fetchCurrentOrders = async (): Promise<CurrentOrderItem[]> => {
  const response = await apiClient.get<CurrentOrderItem[]>('/orders/me/current');
  return response.data;
};

export const placeOrderFromCart = async (payload: PlaceOrderPayload): Promise<PlaceOrderResponse> => {
  const response = await apiClient.post<PlaceOrderResponse>('/orders/me/place', payload);
  return response.data;
};

export const deleteOrderFromHistory = async (orderId: number): Promise<void> => {
  await apiClient.delete(`/orders/me/history/${orderId}`);
};
