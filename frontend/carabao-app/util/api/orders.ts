import { apiClient } from './client';
import type { CartItem } from './cart';
import type { Review } from './reviews';
import type { OrderStatus, PaymentStatus } from './statuses';

export type OrderHistoryItem = {
  id: number;
  order_id: number;
  merchant: string;
  merchant_id?: number | null;
  merchant_page_slug?: string | null;
  merchant_logo_url?: string | null;
  total_amount: number;
  order_date: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  items: CartItem[];
  delivery_address?: string | null;
  requested_delivery_date?: string | null; // YYYY-MM-DD
  delivery_window?: string | null;
  notes?: string | null;
};

export type CurrentOrderItem = {
  id: number;
  order_id: number;
  merchant: string;
  merchant_id?: number | null;
  merchant_page_slug?: string | null;
  merchant_logo_url?: string | null;
  shipped: boolean;
  date_bought: string;
  time_of_arrival: string | null;
  shipped_at?: string | null;
  auto_confirm_at?: string | null;
  delivery_fee: number;
  image: string | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  items: CartItem[];
  total_amount?: number;
  delivery_address?: string | null;
  requested_delivery_date?: string | null; // YYYY-MM-DD
  delivery_window?: string | null;
  notes?: string | null;
};

export type PlaceOrderPayload = {
  delivery_date?: string | null;
  delivery_time?: string | null;
  delivery_address?: string | null;
  // Region picked at checkout; the server rejects regions outside Luzon (B2).
  delivery_region?: string | null;
  // Map pin for the delivery address (U1).
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  payment_method?: string | null;
  notes?: string | null;
  service_fee?: number;
  image?: string | null;
};

export type PlacedOrder = {
  order_id: number;
  order_reference: string;
  status: OrderStatus;
  merchant_id: number;
  merchant_name: string;
  total_price: number;
  delivery_fee: number;
};

export type PlaceOrderResponse = {
  // The first order; `orders` lists every one (one per merchant in the cart).
  order_id: number;
  order_reference: string;
  status: OrderStatus;
  orders?: PlacedOrder[];
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

export const confirmOrderReceived = async (orderId: number): Promise<CurrentOrderItem> => {
  const response = await apiClient.post<CurrentOrderItem>(`/orders/me/${orderId}/confirm-received`);
  return response.data;
};

export const deleteOrderFromHistory = async (orderId: number): Promise<void> => {
  await apiClient.delete(`/orders/me/history/${orderId}`);
};

export type OrderDetail = CurrentOrderItem & {
  delivered_at?: string | null;
  delivery_confirmed_by?: string | null;
  review?: Review | null;
  can_review: boolean;
  review_deadline?: string | null;
};

export const fetchOrder = async (orderId: number): Promise<OrderDetail> => {
  const response = await apiClient.get<OrderDetail>(`/orders/me/${orderId}`);
  return response.data;
};

// "Buy again" (U3): refills the cart with what is still available.
export type ReorderResult = {
  added: { produce_id: number; name: string; quantity: number; price: number; reduced_from: number | null }[];
  unavailable: { name: string; reason: string }[];
};

export const reorderOrder = async (orderId: number): Promise<ReorderResult> => {
  const response = await apiClient.post<ReorderResult>(`/orders/me/${orderId}/reorder`);
  return response.data;
};
