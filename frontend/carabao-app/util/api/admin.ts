import { apiClient } from './client';
import type { UserProfile } from './users';
import type { Merchant, MerchantPayoutBatch, PayoutProvider, PayoutType } from './merchants';
import type { OrderStatus, PayoutStatus } from './statuses';

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
  status: OrderStatus;
  count: number;
};

export type PayoutSummaryItem = {
  status: PayoutStatus;
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

export type PayoutDestination = {
  type: PayoutType;
  institution: string | null;
  name: string | null;
  number: string | null;
  provider: PayoutProvider | null;
  /** Set when the merchant's method can't be sent to yet. */
  problem: string | null;
};

export type PayoutBatch = MerchantPayoutBatch & {
  merchant_name: string | null;
  /** Where the batch goes if sent now (the merchant's current method). */
  destination: PayoutDestination | null;
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

/** Sends the batch through PayMongo (or resends a failed one). */
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

export const refreshPayoutBatch = async (batchId: number): Promise<PayoutBatch> => {
  const res = await apiClient.post<PayoutBatch>(`/admin/batches/${batchId}/refresh`);
  return res.data;
};

/** The PayMongo wallet payouts are sent from, in pesos. */
export type WalletBalance = { available: number; pending: number };

export const fetchWalletBalance = async (): Promise<WalletBalance> => {
  const res = await apiClient.get<WalletBalance>('/admin/wallet');
  return res.data;
};

// ── Orders (A1) ──────────────────────────────────────────────────────────────

export type AdminOrderStatus = 'pending' | 'processing' | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type AdminPaymentStatus = 'awaiting_payment' | 'paid' | 'refund_pending' | 'refunded' | 'unpaid';

export type AdminOrderSummary = {
  id: number;
  status: AdminOrderStatus;
  payment_status: AdminPaymentStatus;
  total_price: number;
  delivery_fee: number;
  ordered_at: string;
  merchant_id: number | null;
  merchant_name: string | null;
  buyer_id: number | null;
  buyer_name: string | null;
  buyer_email: string | null;
  shipment_id: number | null;
};

export type AdminOrderDetail = AdminOrderSummary & {
  items: Record<string, unknown>[];
  notes: string | null;
  transactions: {
    id: number;
    status: string;
    amount: number;
    platform_fee: number;
    merchant_amount: number;
    paymongo_payment_id: string | null;
    created_at: string;
    paid_at: string | null;
  }[];
  shipment: { id: number; status: string; stop_count: number; shipped_at: string | null } | null;
  delivery: {
    delivery_address: string | null;
    requested_delivery_date: string | null;
    delivery_window: string | null;
    time_of_arrival: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
    delivery_confirmed_by: string | null;
  };
};

export type AdminOrderFilters = {
  status?: AdminOrderStatus;
  merchant_id?: number;
  payment_status?: AdminPaymentStatus;
  date_from?: string; // YYYY-MM-DD
  date_to?: string; // YYYY-MM-DD, inclusive
};

export const fetchAdminOrders = async (
  filters: AdminOrderFilters,
  page = 1,
  pageSize = ADMIN_PAGE_SIZE,
): Promise<Paginated<AdminOrderSummary>> => {
  const res = await apiClient.get<Paginated<AdminOrderSummary>>('/admin/orders', {
    params: { ...filters, page, page_size: pageSize },
  });
  return res.data;
};

export const fetchAdminOrder = async (orderId: number): Promise<AdminOrderDetail> => {
  const res = await apiClient.get<AdminOrderDetail>(`/admin/orders/${orderId}`);
  return res.data;
};
