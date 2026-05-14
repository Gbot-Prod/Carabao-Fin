import { apiClient } from './client';
import type { Produce } from './produce';

export type Merchant = {
  id: number;
  user_id: number;
  merchant_name: string;
  location: string | null;
  contact_number: string;
  operating_hours: string | Record<string, string> | null;
  delivery_price: number | null;
  delivery_time: number | null;
  rating: number | null;
  produces: Produce[];
};

export type MerchantCreatePayload = {
  merchant_name: string;
  location?: string | null;
  contact_number: string;
  operating_hours?: string | Record<string, string> | null;
  delivery_price?: number | null;
  delivery_time?: number | null;
  rating?: number | null;
};

export type MerchantOnboardingPayload = {
  merchant_name: string;
  legal_business_name: string;
  business_type: string;
  tin?: string | null;
  registration_type?: string | null;
  registration_number?: string | null;
  contact_email: string;
  contact_number: string;
  address_line: string;
  city: string;
  province?: string | null;
  region?: string | null;
  postal_code?: string | null;
  price_range_min: number;
  price_range_max: number;
  available_days: string[];
  rsbsa_number?: string | null;
};

export type ShopPage = {
  id: number;
  merchant_id: number;
  title: string;
  slug: string;
  banner_image_url: string | null;
  logo_url: string | null;
  description: string | null;
};

export type MerchantPerformance = {
  merchant_id: number;
  merchant_name: string;
  rating?: number | null;
  total_products: number;
  total_orders: number;
  active_orders: number;
  delivered_orders: number;
  cancelled_orders: number;
  total_revenue: number;
  last_order_at?: string | null;
  last_30_days_orders: number;
  last_30_days_revenue: number;
};

export const fetchMerchants = async (): Promise<Merchant[]> => {
  const response = await apiClient.get<Merchant[]>('/merchants');
  return response.data;
};

export const fetchMerchantById = async (merchantId: number): Promise<Merchant> => {
  const response = await apiClient.get<Merchant>(`/merchants/${merchantId}`);
  return response.data;
};

export const createMyMerchant = async (payload: MerchantCreatePayload): Promise<Merchant> => {
  const response = await apiClient.post<Merchant>('/merchants/me', payload);
  return response.data;
};

export type MerchantUpdatePayload = {
  merchant_name?: string | null;
  location?: string | null;
  contact_number?: string | null;
  operating_hours?: string | null;
  delivery_price?: number | null;
  delivery_time?: number | null;
};

export const updateMyMerchant = async (payload: MerchantUpdatePayload): Promise<Merchant> => {
  const response = await apiClient.patch<Merchant>('/merchants/me', payload);
  return response.data;
};

export const submitMyMerchantOnboarding = async (
  payload: MerchantOnboardingPayload,
  rsbsaFile: File,
): Promise<Merchant> => {
  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  formData.append('rsbsa_file', rsbsaFile);
  const response = await apiClient.post<Merchant>('/merchant-onboarding/me', formData);
  return response.data;
};

export const fetchMyMerchantPerformance = async (): Promise<MerchantPerformance> => {
  const response = await apiClient.get<MerchantPerformance>('/merchants/me/performance');
  return response.data;
};

export const deleteMyMerchant = async (): Promise<void> => {
  await apiClient.delete('/merchants/me');
};

export const fetchMerchantShopPage = async (merchantId: number): Promise<ShopPage> => {
  const response = await apiClient.get<ShopPage>(`/merchants/${merchantId}/shoppage`);
  return response.data;
};

export const createMyShopPage = async (payload: { title: string; slug: string; description?: string | null }): Promise<ShopPage> => {
  const response = await apiClient.post<ShopPage>('/merchants/me/shoppage', payload);
  return response.data;
};

export const updateMyShopPage = async (payload: { title?: string; slug?: string; description?: string | null }): Promise<ShopPage> => {
  const response = await apiClient.patch<ShopPage>('/merchants/me/shoppage', payload);
  return response.data;
};

export const uploadBannerImage = async (file: File): Promise<ShopPage> => {
  const formData = new FormData();
  formData.append('banner', file);
  const response = await apiClient.post<ShopPage>('/merchants/me/shoppage/banner', formData);
  return response.data;
};

export const uploadShopLogo = async (file: File): Promise<ShopPage> => {
  const formData = new FormData();
  formData.append('logo', file);
  const response = await apiClient.post<ShopPage>('/merchants/me/shoppage/logo', formData);
  return response.data;
};

// ── Payout ────────────────────────────────────────────────────────────────────

export type PayoutInfo = {
  id: number;
  merchant_id: number;
  payout_type: string;
  bank_code: string | null;
  account_number: string | null;
  account_name: string | null;
  ewallet_number: string | null;
  created_at: string;
  updated_at: string;
};

export type PayoutInfoPayload = {
  payout_type: string;
  bank_code?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  ewallet_number?: string | null;
};

export type MerchantPayoutBatch = {
  id: number;
  merchant_id: number;
  period_date: string;
  transaction_count: number;
  gross_amount: number;
  status: string;
  notes: string | null;
  released_at: string | null;
  created_at: string;
};

export type MerchantTransaction = {
  id: number;
  order_id: number;
  amount: number;
  merchant_amount: number;
  status: string;
  description: string | null;
  created_at: string;
  paid_at: string | null;
};

export const fetchMyPayoutInfo = async (): Promise<PayoutInfo | null> => {
  const response = await apiClient.get<PayoutInfo | null>('/merchants/me/payout-info');
  return response.data;
};

export const updateMyPayoutInfo = async (payload: PayoutInfoPayload): Promise<PayoutInfo> => {
  const response = await apiClient.put<PayoutInfo>('/merchants/me/payout-info', payload);
  return response.data;
};

export const fetchMyPayouts = async (): Promise<MerchantPayoutBatch[]> => {
  const response = await apiClient.get<MerchantPayoutBatch[]>('/merchants/me/payouts');
  return response.data;
};

export const fetchMyTransactions = async (): Promise<MerchantTransaction[]> => {
  const response = await apiClient.get<MerchantTransaction[]>('/merchants/me/transactions');
  return response.data;
};

export const requestPayout = async (): Promise<MerchantPayoutBatch> => {
  const response = await apiClient.post<MerchantPayoutBatch>('/merchants/me/payouts/request');
  return response.data;
};

// ── Merchant orders ────────────────────────────────────────────────────────────

export type MerchantOrder = {
  id: number;
  status: string;
  total_price: number;
  items: Array<{ id?: string; produce?: string; quantity?: number; price?: number; unit?: string; farm?: string }>;
  delivery_address: string | null;
  ordered_at: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  shipped: boolean;
  time_of_arrival: string | null;
};

export const fetchMyMerchantOrders = async (): Promise<MerchantOrder[]> => {
  const response = await apiClient.get<MerchantOrder[]>('/merchants/me/orders');
  return response.data;
};

export const updateMerchantOrderStatus = async (orderId: number, status: string): Promise<MerchantOrder> => {
  const response = await apiClient.patch<MerchantOrder>(`/merchants/me/orders/${orderId}/status`, null, { params: { status } });
  return response.data;
};
