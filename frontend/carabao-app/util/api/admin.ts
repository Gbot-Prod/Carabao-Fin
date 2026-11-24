import { apiClient } from './client';
import type { UserProfile } from './users';
import type { Merchant, MerchantPayoutBatch, PayoutProvider, PayoutType, SellerType, VatStatus } from './merchants';
import type { OrderStatus, PayoutStatus, TransactionStatus } from './statuses';
import type { ListingPenalty, Produce, ProduceStatus } from './produce';

export type MerchantApplication = {
  id: number;
  user_id: number;
  status: string;
  submitted_at: string | null;
  /** Unset while the application is pending_documents (Submit later). */
  merchant_name: string | null;
  legal_business_name: string | null;
  seller_type: SellerType | null;
  last_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  suffix: string | null;
  rep_last_name: string | null;
  rep_first_name: string | null;
  rep_middle_name: string | null;
  rep_suffix: string | null;
  company_name: string | null;
  trade_name: string | null;
  vat_status: VatStatus | null;
  bir_cert_document_original_name: string | null;
  bir_cert_document_content_type: string | null;
  small_agri_producer: boolean | null;
  small_agri_declared_at: string | null;
  small_agri_declared_year: number | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
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
  available_days: string[];
  /** The farm pin saved with step 1 (owner and admin views). */
  lat?: number | null;
  lng?: number | null;
  pin_confirmed?: boolean;
  rsbsa_number: string | null;
  rsbsa_document_original_name: string | null;
  rsbsa_document_content_type: string | null;
  gov_id_type: string | null;
  gov_id_document_original_name: string | null;
  gov_id_document_content_type: string | null;
  admin_note: string | null;
  reviewed_at: string | null;
  merchant_id?: number | null;
  /** Admin view only: the automated document checks (backend document_checks.py). */
  check_status?: 'pending' | 'completed' | 'failed' | null;
  checked_at?: string | null;
  name_match_score?: number | null;
  check_checklist?: ChecklistItem[] | null;
  check_confirmations?: Record<string, { by: number | null; at: string; result: string }> | null;
};

export type ChecklistResult = 'pass' | 'warn' | 'fail' | 'not_checked';
export type ChecklistItem = {
  id: string;
  label: string;
  result: ChecklistResult;
  reason: string;
  /** rsbsa | gov_id | bir_cert, when the item is about one document. */
  document: 'rsbsa' | 'gov_id' | 'bir_cert' | null;
  /** Other applications sharing a number or file (duplicates check). */
  related_application_ids: number[];
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
  /** Saved with "Submit later": no business information yet, nothing to review. */
  incomplete_applications?: number;
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

export type AdminMerchantShop = {
  id: number;
  title: string;
  slug: string;
  banner_image_url: string | null;
  logo_url: string | null;
  description: string | null;
};

// The admin API sends the full profile (AdminMerchantResponse), owner id included.
export type AdminMerchant = Merchant & {
  user_id: number;
  owner_is_suspended: boolean;
  owner_suspension_reason: string | null;
  owner_name: string | null;
  legal_business_name: string | null;
  seller_type: SellerType | null;
  vat_status: VatStatus | null;
  small_agri_producer: boolean | null;
  registration_type: string | null;
  registration_number: string | null;
  low_stock_threshold: number | null;
  created_at: string | null;
  verified_at: string | null;
  deleted_at: string | null;
  shop_page: AdminMerchantShop | null;
};

export const fetchAdminMerchantsPage = async (page = 1, pageSize = ADMIN_PAGE_SIZE): Promise<Paginated<AdminMerchant>> => {
  const res = await apiClient.get<Paginated<AdminMerchant>>('/admin/merchants', {
    params: { page, page_size: pageSize },
  });
  return res.data;
};

export type AdminListWindow = { limit?: number; offset?: number };

/** Newest first, one window (CF-0067). `status` repeats: ?status=a&status=b. */
export const fetchAdminMerchantApplications = async (
  { status, ...window }: { status?: string[] } & AdminListWindow = {},
): Promise<MerchantApplication[]> => {
  const res = await apiClient.get<MerchantApplication[]>('/admin/merchant-applications', {
    params: { ...window, ...(status?.length ? { status } : {}) },
    paramsSerializer: { indexes: null },
  });
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

/** Newest first, one window (CF-0067). */
export const fetchAdminPayoutBatches = async (status?: string, window: AdminListWindow = {}): Promise<PayoutBatch[]> => {
  const res = await apiClient.get<PayoutBatch[]>('/admin/batches', { params: { ...window, ...(status ? { status } : {}) } });
  return res.data;
};

/** Sends the batch through PayMongo (or resends a failed one). */
export const releasePayoutBatch = async (batchId: number, notes?: string): Promise<PayoutBatch> => {
  const res = await apiClient.patch<PayoutBatch>(`/admin/batches/${batchId}/release`, null, {
    params: notes ? { notes } : {},
  });
  return res.data;
};

// ── Admin accounts (DB_ROLE_SPLIT_PLAN.md section 2) ───────────────────────
// Admins are invited, never promoted. The invite code is returned once, to be
// handed to the new admin directly; it is never emailed or shown again.

export type AdminInvite = { user: UserProfile; code: string; expires_at: string };

export const inviteAdmin = async (email: string, name: string): Promise<AdminInvite> => {
  const res = await apiClient.post<AdminInvite>('/admin/invites', { email, name });
  return res.data;
};

/** A new link and code for an invite not accepted yet; the old ones stop working. */
export const resendAdminInvite = async (userId: number): Promise<AdminInvite> => {
  const res = await apiClient.post<AdminInvite>(`/admin/invites/${userId}/resend`);
  return res.data;
};

/** Public: the invite link's id and token, the code and the new password. */
export const acceptAdminInvite = async (payload: {
  invite: string;
  token: string;
  code: string;
  password: string;
}): Promise<{ email: string }> => {
  const res = await apiClient.post<{ email: string }>('/admin/invites/accept', payload);
  return res.data;
};

export const deactivateAdmin = async (userId: number): Promise<UserProfile> => {
  const res = await apiClient.post<UserProfile>(`/admin/admins/${userId}/deactivate`);
  return res.data;
};

/** Always a new invite (any old password and 2FA are removed). */
export const reactivateAdmin = async (userId: number): Promise<AdminInvite> => {
  const res = await apiClient.post<AdminInvite>(`/admin/admins/${userId}/reactivate`);
  return res.data;
};

/** Lost authenticator or forgotten password: the admin's password, 2FA and
 * sessions are removed, and a new invite is emailed. The code is returned once. */
export const resetAdminAccount = async (userId: number): Promise<AdminInvite> => {
  const res = await apiClient.post<AdminInvite>(`/admin/admins/${userId}/reset`);
  return res.data;
};

export const reviewMerchantApplication = async (
  id: number,
  status: "approved" | "rejected" | "clarification" | "suspended",
  admin_note?: string,
  /** The checklist items the admin ticked; Accept needs every warn and fail one. */
  confirmed_items: string[] = [],
): Promise<MerchantApplication> => {
  const res = await apiClient.patch<MerchantApplication>(`/admin/merchant-applications/${id}`, {
    status,
    admin_note: admin_note ?? null,
    confirmed_items,
  });
  return res.data;
};

/** Run the automated document checks again (they failed, or need a refresh). */
export const rerunDocumentChecks = async (id: number): Promise<MerchantApplication> => {
  const res = await apiClient.post<MerchantApplication>(`/admin/merchant-applications/${id}/checks/rerun`);
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

export const fetchGovIdDocumentUrl = async (
  applicationId: number,
): Promise<RsbsaDocumentUrl> => {
  const response = await apiClient.get<RsbsaDocumentUrl>(
    `/admin/merchant-applications/${applicationId}/gov-id-document`,
  );

  return response.data;
};

/** BIR Certificate of Registration (Form 2303), registered seller types. */
export const fetchBirCertDocumentUrl = async (
  applicationId: number,
): Promise<RsbsaDocumentUrl> => {
  const response = await apiClient.get<RsbsaDocumentUrl>(
    `/admin/merchant-applications/${applicationId}/bir-cert-document`,
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

export type AdminOrderStatus =
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'payment_mismatch';
export type AdminPaymentStatus = 'awaiting_payment' | 'paid' | 'refund_pending' | 'refunded' | 'unpaid';

export type AdminOrderSummary = {
  id: number;
  status: AdminOrderStatus;
  payment_status: AdminPaymentStatus;
  total_price: number;
  delivery_fee: number;
  /** CF-0065: farm voucher; total_price is already net of it. */
  discount?: number;
  voucher_code?: string | null;
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
    cancel_reason?: string | null;
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

// CF-0045: cancel an order the farm cannot complete; a paid order goes to the refund queue.
export const cancelAdminOrder = async (orderId: number, reason: string): Promise<AdminOrderDetail> => {
  const res = await apiClient.post<AdminOrderDetail>(`/admin/orders/${orderId}/cancel`, { reason });
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

export type AdminProduce = Produce & {
  merchant_name: string | null;
  // Guardrails Phase 1: the market range the name matches (sample data says so).
  reference_price?: { commodity: string; unit: string; low: number; high: number; sample: boolean } | null;
  // Guardrails Phase 3: open buyer reports, oldest first. An approve, reject
  // or hide closes them.
  open_reports?: AdminListingReport[];
};

export type AdminListingReport = {
  id: number;
  reporter_id: number;
  reason: string;
  label: string;
  note: string | null;
  created_at: string;
};

export const fetchAdminProduce = async (
  filters: { hidden?: boolean; status?: ProduceStatus; q?: string; merchant_id?: number },
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

// ── Listing review queue (guardrails Phase 1) ───────────────────────────────

/** `points`: penalty points a rejection with this reason gives (guardrails Phase 2). */
export type RejectionCode = { code: string; label: string; points: number };

export const fetchRejectionCodes = async (): Promise<RejectionCode[]> => {
  const res = await apiClient.get<RejectionCode[]>('/admin/produce/rejection-codes');
  return res.data;
};

export const approveProduce = async (produceId: number): Promise<AdminProduce> => {
  const res = await apiClient.post<AdminProduce>(`/admin/produce/${produceId}/approve`);
  return res.data;
};

export const rejectProduce = async (produceId: number, code: string, note: string): Promise<AdminProduce> => {
  const res = await apiClient.post<AdminProduce>(`/admin/produce/${produceId}/reject`, {
    code,
    note: note.trim() || null,
  });
  return res.data;
};

// ── Penalty points (guardrails Phase 2) ─────────────────────────────────────

export type AdminPenalty = ListingPenalty & {
  merchant_id: number;
  merchant_name: string | null;
  active: boolean;
};

export type PenaltyAccount = {
  merchant_id: number;
  merchant_name: string | null;
  points: number;
  blocked_until: string | null;
  can_create_listings: boolean;
  needs_account_review: boolean;
  shop_suspended: boolean;
  owner_suspended: boolean;
};

export const fetchPenaltyAccounts = async (minPoints = 1): Promise<PenaltyAccount[]> => {
  const res = await apiClient.get<PenaltyAccount[]>('/admin/penalties/accounts', {
    params: { min_points: minPoints },
  });
  return res.data;
};

export const fetchPenalties = async (
  filters: { merchant_id?: number; active?: boolean },
  page = 1,
  pageSize = ADMIN_PAGE_SIZE,
): Promise<Paginated<AdminPenalty>> => {
  const res = await apiClient.get<Paginated<AdminPenalty>>('/admin/penalties', {
    params: { ...filters, page, page_size: pageSize },
  });
  return res.data;
};

export const revokePenalty = async (penaltyId: number, reason: string): Promise<AdminPenalty> => {
  const res = await apiClient.post<AdminPenalty>(`/admin/penalties/${penaltyId}/revoke`, {
    reason: reason.trim(),
  });
  return res.data;
};

export type TermCategory = 'contact' | 'prohibited_commodity' | 'profanity' | 'spam';
export type TermSeverity = 'hard_block' | 'soft_flag';
export type TermLanguage = 'en' | 'tl' | 'ceb' | 'all';
export type ProhibitedTerm = {
  id: number;
  term: string;
  category: TermCategory;
  severity: TermSeverity;
  language: TermLanguage;
  is_active: boolean;
};

export const fetchProhibitedTerms = async (
  filters: { category?: TermCategory; severity?: TermSeverity; active?: boolean; q?: string },
  page = 1,
  pageSize = 50,
): Promise<Paginated<ProhibitedTerm>> => {
  const res = await apiClient.get<Paginated<ProhibitedTerm>>('/admin/prohibited-terms', {
    params: { ...filters, page, page_size: pageSize },
  });
  return res.data;
};

export const createProhibitedTerm = async (payload: {
  term: string;
  category: TermCategory;
  severity: TermSeverity;
  language: TermLanguage;
}): Promise<ProhibitedTerm> => {
  const res = await apiClient.post<ProhibitedTerm>('/admin/prohibited-terms', payload);
  return res.data;
};

export const updateProhibitedTerm = async (
  id: number,
  changes: Partial<Pick<ProhibitedTerm, 'category' | 'severity' | 'language' | 'is_active'>>,
): Promise<ProhibitedTerm> => {
  const res = await apiClient.patch<ProhibitedTerm>(`/admin/prohibited-terms/${id}`, changes);
  return res.data;
};

/** CF-0075: review moderation. */
export type AdminReview = {
  id: number;
  order_id: number | null;
  merchant_id: number;
  merchant_name: string | null;
  reviewer_name: string;
  rating: number;
  comment: string | null;
  merchant_reply: string | null;
  created_at: string;
  hidden_at: string | null;
  hidden_reason: string | null;
};

export const fetchAdminReviews = async (
  filters: { hidden?: boolean; max_rating?: number; q?: string; merchant_id?: number },
  page = 1,
  pageSize = ADMIN_PAGE_SIZE,
): Promise<Paginated<AdminReview>> => {
  const res = await apiClient.get<Paginated<AdminReview>>('/admin/reviews', {
    params: { ...filters, page, page_size: pageSize },
  });
  return res.data;
};

export const hideReview = async (reviewId: number, reason: string): Promise<AdminReview> => {
  const res = await apiClient.post<AdminReview>(`/admin/reviews/${reviewId}/hide`, { reason });
  return res.data;
};

export const unhideReview = async (reviewId: number): Promise<AdminReview> => {
  const res = await apiClient.post<AdminReview>(`/admin/reviews/${reviewId}/unhide`);
  return res.data;
};
