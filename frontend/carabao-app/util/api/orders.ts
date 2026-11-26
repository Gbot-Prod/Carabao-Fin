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
  notes?: string | null;
  delivery_fee?: number;
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
  delivery_address?: string | null;
  notes?: string | null;
};

export type PlaceOrderPayload = {
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
  /** ORDER_PROOF_PHOTOS_PLAN.md: the proof photos the buyer may see. */
  proof_photos?: BuyerProofKind[];
  /** A merchant-set delivery: "I did not get this" is open until this time. */
  dispute_until?: string | null;
  can_dispute?: boolean;
  delivery_buyer_confirmed_at?: string | null;
  delivery_disputed_at?: string | null;
  dispute_resolution?: "release" | "refund" | null;
};

export type BuyerProofKind = "packing" | "dropoff";

export const fetchOrder = async (orderId: number): Promise<OrderDetail> => {
  const response = await apiClient.get<OrderDetail>(`/orders/me/${orderId}`);
  return response.data;
};

/** The image bytes of a proof photo; the endpoint needs the Bearer token, so no plain <img src>. */
export const fetchOrderProofPhoto = async (orderId: number, kind: BuyerProofKind): Promise<Blob> => {
  const response = await apiClient.get<Blob>(`/orders/me/${orderId}/proof/${kind}`, { responseType: "blob" });
  return response.data;
};

/** "I did not get this": the farm marked the order delivered, but it did not arrive. */
export const disputeOrderDelivery = async (orderId: number): Promise<OrderDetail> => {
  const response = await apiClient.post<OrderDetail>(`/orders/me/${orderId}/dispute-delivery`);
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
  /** "Acknowledgement receipt — not a BIR invoice" for a declared small producer (BIR RR No. 12-2023). */
  document_label?: string | null;
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
  lines: ReceiptLine[];
  subtotal: number;
  delivery_fee: number;
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

// ── Disputed deliveries (merchant) ───────────────────────────────────────────

/** A buyer said "I did not get this" about a delivery the farm marked with a photo. */
export type MerchantDispute = {
  order_id: number;
  order_ref: string;
  total_amount: number;
  item_summary: string;
  delivered_at: string | null;
  disputed_at: string;
  /** Open: the payout waits for Carabao's decision. */
  open: boolean;
  resolution: 'release' | 'refund' | null;
  resolved_at: string | null;
  merchant_note: string | null;
  merchant_noted_at: string | null;
};

export const DISPUTE_NOTE_MAX = 1000;

export const fetchMerchantDisputes = async (): Promise<MerchantDispute[]> => {
  const response = await apiClient.get<MerchantDispute[]>('/orders/merchant/disputes');
  return response.data;
};

/** The farm's side of an open dispute; it can be changed until Carabao decides. */
export const setMerchantDisputeNote = async (orderId: number, note: string): Promise<MerchantDispute> => {
  const response = await apiClient.put<MerchantDispute>(`/orders/merchant/${orderId}/dispute-note`, { note });
  return response.data;
};
