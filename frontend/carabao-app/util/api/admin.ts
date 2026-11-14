import { apiClient } from './client';
import type { UserProfile } from './users';
import type { Merchant, MerchantPayoutBatch, PayoutProvider, PayoutType } from './merchants';
import type { OrderStatus, PayoutStatus, TransactionStatus } from './statuses';
import type { Produce } from './produce';

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

export type WeeklySignups = {
  week_start: string; // Monday, YYYY-MM-DD (Manila)
  buyers: number;
  merchants: number;
};

export type CategorySales = {
  category: string;
  revenue: number; // item revenue in pesos, delivery fee excluded
  quantity: number;
};

export type AdminStats = {
  total_revenue: number;
  platform_fees: number;
  total_orders: number;
  total_users: number;
  active_merchants: number;
  pending_applications: number;
  pending_work: {
    applications: number;
    payouts_to_send: number;
    refunds_pending: number;
  };
  weekly_signups: WeeklySignups[];
  top_categories: CategorySales[];
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

export type AdminMerchant = Merchant & {
  owner_is_suspended: boolean;
  owner_suspension_reason: string | null;
};

export const fetchAdminMerchantsPage = async (page = 1, pageSize = ADMIN_PAGE_SIZE): Promise<Paginated<AdminMerchant>> => {
  const res = await apiClient.get<Paginated<AdminMerchant>>('/admin/merchants', {
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
    refund_method: string | null;
    refund_reference: string | null;
    refunded_at: string | null;
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

// ── Transactions ledger ──────────────────────────────────────────────────────

export type AdminTransaction = {
  id: number;
  order_id: number;
  status: TransactionStatus;
  amount: number;
  platform_fee: number;
  merchant_amount: number;
  description: string | null;
  paymongo_session_id: string | null;
  paymongo_payment_id: string | null;
  created_at: string;
  paid_at: string | null;
  merchant_id: number;
  merchant_name: string | null;
  buyer_id: number;
  buyer_name: string | null;
  buyer_email: string | null;
  refund_method: string | null;
  refund_reference: string | null;
  refunded_at: string | null;
};

export type AdminTransactionTotals = {
  count: number;
  amount: number;
  platform_fee: number;
  merchant_amount: number;
};

export type AdminTransactionFilters = {
  status?: TransactionStatus;
  merchant_id?: number;
  date_from?: string; // YYYY-MM-DD, on created_at
  date_to?: string; // YYYY-MM-DD, inclusive
  q?: string; // PayMongo ID, #order/transaction ID, buyer email, refund ref
};

export const fetchAdminTransactions = async (
  filters: AdminTransactionFilters,
  page = 1,
  pageSize = ADMIN_PAGE_SIZE,
): Promise<Paginated<AdminTransaction> & { totals: AdminTransactionTotals }> => {
  const res = await apiClient.get<Paginated<AdminTransaction> & { totals: AdminTransactionTotals }>(
    '/admin/transactions',
    { params: { ...filters, page, page_size: pageSize } },
  );
  return res.data;
};

// Goes through apiClient (not a plain link) so the Bearer token is sent.
export const downloadAdminTransactionsCsv = async (filters: AdminTransactionFilters): Promise<void> => {
  const res = await apiClient.get<Blob>('/admin/transactions/export', {
    params: filters,
    responseType: 'blob',
  });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'transactions.csv';
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// ── Refunds (A2) ─────────────────────────────────────────────────────────────

export type RefundMethod = 'paymongo' | 'gcash' | 'maya' | 'bank_transfer' | 'cash';

export const REFUND_METHOD_LABELS: Record<RefundMethod, string> = {
  paymongo: 'PayMongo refund',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
};

export type AdminRefund = {
  transaction_id: number;
  order_id: number;
  order_status: string;
  status: 'refund_pending' | 'refunded';
  amount: number;
  paymongo_payment_id: string | null;
  paid_at: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  merchant_name: string | null;
  refund_method: RefundMethod | null;
  refund_reference: string | null;
  refund_notes: string | null;
  refunded_at: string | null;
};

export const fetchAdminRefunds = async (
  status: 'refund_pending' | 'refunded' = 'refund_pending',
): Promise<AdminRefund[]> => {
  const res = await apiClient.get<AdminRefund[]>('/admin/refunds', { params: { status } });
  return res.data;
};

export const recordRefund = async (
  transactionId: number,
  payload: { method: RefundMethod; reference: string; notes?: string },
): Promise<AdminRefund> => {
  const res = await apiClient.post<AdminRefund>(`/admin/refunds/${transactionId}`, payload);
  return res.data;
};

// ── Suspension (A3) ──────────────────────────────────────────────────────────

export const suspendUser = async (userId: number, reason: string): Promise<UserProfile> => {
  const res = await apiClient.post<UserProfile>(`/admin/users/${userId}/suspend`, { reason });
  return res.data;
};

export const reinstateUser = async (userId: number): Promise<UserProfile> => {
  const res = await apiClient.post<UserProfile>(`/admin/users/${userId}/reinstate`);
  return res.data;
};

// ── Audit log (A4) ───────────────────────────────────────────────────────────

export type AuditLogEntry = {
  id: number;
  admin_id: number | null;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

export const AUDIT_PAGE_SIZE = 50;

export const fetchAuditLog = async (
  filters: { action?: string },
  page = 1,
  pageSize = AUDIT_PAGE_SIZE,
): Promise<Paginated<AuditLogEntry>> => {
  const res = await apiClient.get<Paginated<AuditLogEntry>>('/admin/audit-log', {
    params: { ...filters, page, page_size: pageSize },
  });
  return res.data;
};

export const fetchAuditActions = async (): Promise<string[]> => {
  const res = await apiClient.get<string[]>('/admin/audit-log/actions');
  return res.data;
};

// ── Listing moderation (A6) ──────────────────────────────────────────────────

export type AdminProduce = Produce & { merchant_name: string | null };

export const fetchAdminProduce = async (
  filters: { hidden?: boolean; q?: string; merchant_id?: number },
  page = 1,
  pageSize = ADMIN_PAGE_SIZE,
): Promise<Paginated<AdminProduce>> => {
  const res = await apiClient.get<Paginated<AdminProduce>>('/admin/produce', {
    params: { ...filters, page, page_size: pageSize },
  });
  return res.data;
};

export const hideProduce = async (produceId: number, reason: string): Promise<AdminProduce> => {
  const res = await apiClient.post<AdminProduce>(`/admin/produce/${produceId}/hide`, { reason });
  return res.data;
};

export const unhideProduce = async (produceId: number): Promise<AdminProduce> => {
  const res = await apiClient.post<AdminProduce>(`/admin/produce/${produceId}/unhide`);
  return res.data;
};
