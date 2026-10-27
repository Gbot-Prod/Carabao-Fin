import { apiClient } from './client';
import type { UserProfile } from './users';
import type { Merchant } from './merchants';

export type MerchantApplication = {
  id: number;
  user_id: number;
  status: string;
  submitted_at: string | null;
  merchant_name: string;
  legal_business_name: string;
  business_type: string;
  tin: string | null;
  registration_type: string | null;
  registration_number: string | null;
  contact_email: string;
  contact_number: string;
  region: string | null;
  province: string | null;
  city: string | null;
  barangay: string | null;
  address: string | null;
  postal_code: string | null;
  price_range_min: number;
  price_range_max: number;
  delivery_time: number;
  delivery_price: number;
  available_days: string[];
  rsbsa_number: string | null;
  rsbsa_document_original_name: string | null;
  rsbsa_document_content_type: string | null;
  admin_note: string | null;
};

export type RsbsaDocumentUrl = {
  url: string;
  filename: string | null;
  content_type: string | null;
};

export type DailyRevenue = {
  date: string;
  revenue: number;
  platform_fee: number;
};

export type OrderStatusCount = {
  status: string;
  count: number;
};

export type PayoutSummaryItem = {
  status: string;
  count: number;
  total_amount: number;
};

export type AdminStats = {
  total_revenue: number;
  platform_fees: number;
  total_orders: number;
  total_users: number;
  active_merchants: number;
  pending_applications: number;
  daily_revenue: DailyRevenue[];
  order_breakdown: OrderStatusCount[];
  payout_summary: PayoutSummaryItem[];
};

export type PayoutBatch = {
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

export type { UserProfile, Merchant };

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export const ADMIN_PAGE_SIZE = 20;

export const fetchAdminUsers = async (page = 1, pageSize = ADMIN_PAGE_SIZE): Promise<Paginated<UserProfile>> => {
  const res = await apiClient.get<Paginated<UserProfile>>('/admin/users', {
    params: { page, page_size: pageSize },
  });
  return res.data;
};

export const fetchAdminMerchantsPage = async (page = 1, pageSize = ADMIN_PAGE_SIZE): Promise<Paginated<Merchant>> => {
  const res = await apiClient.get<Paginated<Merchant>>('/admin/merchants', {
    params: { page, page_size: pageSize },
  });
  return res.data;
};

export const fetchAdminMerchantApplications = async (): Promise<MerchantApplication[]> => {
  const res = await apiClient.get<MerchantApplication[]>('/admin/merchant-applications');
  return res.data;
};

export const fetchAdminMerchants = async (): Promise<Merchant[]> => {
  const res = await apiClient.get<Merchant[]>('/merchants');
  return res.data;
};

export const fetchAdminStats = async (): Promise<AdminStats> => {
  const res = await apiClient.get<AdminStats>('/admin/stats');
  return res.data;
};

export const fetchAdminPayoutBatches = async (status?: string): Promise<PayoutBatch[]> => {
  const res = await apiClient.get<PayoutBatch[]>('/admin/batches', { params: status ? { status } : {} });
  return res.data;
};

export const generatePayoutBatches = async (periodDate?: string): Promise<PayoutBatch[]> => {
  const res = await apiClient.post<PayoutBatch[]>('/admin/batches/generate', null, {
    params: periodDate ? { period: periodDate } : {},
  });
  return res.data;
};

export const releasePayoutBatch = async (batchId: number, notes?: string): Promise<PayoutBatch> => {
  const res = await apiClient.patch<PayoutBatch>(`/admin/batches/${batchId}/release`, null, {
    params: notes ? { notes } : {},
  });
  return res.data;
};

export const setUserAdminRole = async (userId: number, isAdmin: boolean): Promise<UserProfile> => {
  const res = await apiClient.patch<UserProfile>(`/admin/users/${userId}/role`, { is_admin: isAdmin });
  return res.data;
};

export const reviewMerchantApplication = async (
  id: number,
  status: "approved" | "rejected" | "clarification",
  admin_note?: string,
): Promise<MerchantApplication> => {
  const res = await apiClient.patch<MerchantApplication>(`/admin/merchant-applications/${id}`, {
    status,
    admin_note: admin_note ?? null,
  });
  return res.data;
};

export const fetchRsbsaDocumentUrl = async (
  applicationId: number,
): Promise<RsbsaDocumentUrl> => {
  const response = await apiClient.get<RsbsaDocumentUrl>(
    `/admin/merchant-applications/${applicationId}/rsbsa-document`,
  );

  return response.data;
};