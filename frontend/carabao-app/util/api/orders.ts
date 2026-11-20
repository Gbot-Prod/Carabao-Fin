import { apiClient } from './client';
import type { CartItem } from './cart';
import type { Review } from './reviews';
import type { OrderStatus, PaymentStatus } from './statuses';
import { historyParams, type HistoryQuery } from '@/lib/order-history';

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
  delivery_fee?: number;
  discount?: number;
  time_of_arrival?: string | null;
  auto_confirm_at?: string | null;
  delivered_at?: string | null;
  /** The buyer has left a review for this order. */
  reviewed?: boolean;
  can_review?: boolean;
  review_deadline?: string | null;
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
  /** Farm voucher on this order (CF-0064); total_amount is already net of it. */
  discount?: number;
  voucher_code?: string | null;
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
  /** The person placed or moved the pin themselves; false = only where the address geocoded to. */
  delivery_pin_confirmed?: boolean;
  // The server refuses unknown fields; items, prices and fees come from the
  // server-side cart and listings.
  notes?: string | null;
  /** One farm voucher code (CF-0064); the server works out the discount. */
  voucher_code?: string | null;
  // The cart lines ticked in the cart, by produce ID. Omit for the whole cart.
  produce_ids?: number[];
};

export type PlacedOrder = {
  order_id: number;
  order_reference: string;
  status: OrderStatus;
  merchant_id: number;
  merchant_name: string;
  total_price: number;
  delivery_fee: number;
  discount?: number;
  voucher_code?: string | null;
};

/** What a code would take off the current cart (CF-0064); nothing is held. */
export type VoucherPreview = {
  code: string;
  merchant_id: number;
  merchant_name: string;
  discount: number;
};

export const previewVoucher = async (voucherCode: string): Promise<VoucherPreview> => {
  const response = await apiClient.post<VoucherPreview>('/orders/me/voucher-preview', {
    voucher_code: voucherCode,
  });
  return response.data;
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

export type OrderHistoryPage = {
  items: OrderHistoryItem[];
  total: number;
  page: number;
  page_size: number;
};

// CF-0036: one page, newest first, optionally filtered by status group or search.
export const fetchOrderHistoryPage = async (query: HistoryQuery): Promise<OrderHistoryPage> => {
  const response = await apiClient.get<OrderHistoryPage>('/orders/me/history/page', {
    params: historyParams(query),
  });
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

/** Cancel a paid order the farm has not shipped yet; the payment goes to the refund queue. */
export const cancelMyOrder = async (orderId: number): Promise<CurrentOrderItem> => {
  const response = await apiClient.post<CurrentOrderItem>(`/orders/me/${orderId}/cancel`);
  return response.data;
};

export const deleteOrderFromHistory = async (orderId: number): Promise<void> => {
  await apiClient.delete(`/orders/me/history/${orderId}`);
};

export type OrderDetail = CurrentOrderItem & {
  delivered_at?: string | null;
  delivery_confirmed_by?: string | null;
  /** Why it was cancelled (farm, admin or the unshipped sweep). */
  cancel_reason?: string | null;
  review?: Review | null;
  can_review: boolean;
  review_deadline?: string | null;
};

export const fetchOrder = async (orderId: number): Promise<OrderDetail> => {
  const response = await apiClient.get<OrderDetail>(`/orders/me/${orderId}`);
  return response.data;
};

// CF-0049: the buyer's receipt for a paid order (backend schemas/receipt.py).
export type ReceiptLine = {
  name: string;
  unit: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type OrderReceipt = {
  receipt_number: string;
  order_id: number;
  order_status: OrderStatus;
  ordered_at: string | null;
  paid_at: string | null;
  payment_status: 'paid' | 'refund_pending' | 'refunded';
  payment_reference: string | null;
  buyer_name: string | null;
  farm_name: string | null;
  farm_town: string | null;
  farm_contact_number: string | null;
  delivery_address: string | null;
  requested_delivery_date: string | null;
  delivery_window: string | null;
  lines: ReceiptLine[];
  subtotal: number;
  delivery_fee: number;
  /** Farm voucher (CF-0058); 0 / null when none was used. */
  discount?: number;
  voucher_code?: string | null;
  total: number;
};

/** 404: not the caller's order; 409: no payment yet. */
export const fetchOrderReceipt = async (orderId: number): Promise<OrderReceipt> => {
  const response = await apiClient.get<OrderReceipt>(`/orders/me/${orderId}/receipt`);
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
