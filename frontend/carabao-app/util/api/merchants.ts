import { apiClient } from './client';
import type { Produce } from './produce';

export type Merchant = {
  id: number;
  user_id: number;
  merchant_name: string;
  location: string | null;
  contact_number: string;
  operating_hours: string | null;
  delivery_price: number | null;
  delivery_time: number | null;
  rating: number | null;
  produces: Produce[];
};

export type MerchantCreatePayload = {
  merchant_name: string;
  location?: string | null;
  contact_number: string;
  operating_hours?: string | null;
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
  province: string;
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
