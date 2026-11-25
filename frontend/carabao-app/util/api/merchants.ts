import { MerchantApplication } from './admin';
import { apiClient } from './client';
import type { Produce } from './produce';
import type { InquirySummary } from './users';
import type { MerchantVerificationStatus, OrderStatus, PaymentStatus, PayoutStatus, TransactionStatus } from './statuses';

export type Merchant = {
  id: number;
  // Owner only (GET /merchants/me): the public routes leave these out, since
  // many farms are someone's home (CF-0048).
  user_id?: number;
  barangay?: string | null;
  address?: string | null;
  // Farm map pin (U1).
  lat?: number | null;
  lng?: number | null;
  /** The person placed or moved the pin themselves; false = only where the address geocoded to. */
  pin_confirmed?: boolean;
  legal_business_name?: string | null;
  merchant_name: string;
  region: string | null;
  province: string | null;
  city: string | null;
  postal_code: string | null;
  category: string | null;
  contact_number: string;
  contact_email?: string | null;
  /** Owning user's full name. Only returned by the single-merchant endpoint. */
  owner_name?: string | null;
  available_days: string[];
  operating_hours: string | Record<string, string> | null;
  /** Flat delivery fee per order, in pesos; the merchant sets it (CF-0020). */
  delivery_price: number | null;
  delivery_time: number | null;
  rating: number | null;
  // Number of reviews behind `rating` (public GET /merchants/{id}).
  rating_count?: number;
  /** Last change to the farm row (CF-0041, sitemap lastModified). */
  updated_at?: string | null;
  /** CF-0066 holiday mode: no orders through this day (yyyy-mm-dd, Manila). */
  paused_until?: string | null;
  pause_message?: string | null;
  /** Owner view: whether the farm may sell yet. */
  verification_status?: MerchantVerificationStatus | null;
  /** The public list and detail include the shop page (CF-0056). */
  shop_page?: Pick<ShopPage, 'logo_url' | 'banner_image_url' | 'slug'> | null;
  produces: Produce[];
};

/** Who is selling (backend SellerType). It decides the name, registration and tax fields. */
export const SELLER_TYPES = ["individual_farmer", "sole_proprietor", "corporation", "cooperative"] as const;
export type SellerType = (typeof SELLER_TYPES)[number];
/** Short labels for admin screens. */
export const SELLER_TYPE_LABELS: Record<SellerType, string> = {
  individual_farmer: "Individual farmer (not business-registered)",
  sole_proprietor: "Sole proprietorship",
  corporation: "Corporation / Partnership / OPC",
  cooperative: "Cooperative",
};
export const NAME_SUFFIXES = ["Jr.", "Sr.", "II", "III", "IV", "V"] as const;
export type NameSuffix = (typeof NAME_SUFFIXES)[number];
/** As on the government ID (individual seller types). */
export type Sex = "male" | "female";
export type VatStatus = "vat_registered" | "non_vat";
/** "now": the business information comes with this submit. "later": step 1 and the seller type only. */
export type SubmitMode = "now" | "later";

/**
 * The onboarding form. Section 2 fields are optional here; which ones a
 * submit needs depends on submit_mode and seller_type (backend
 * BUSINESS_DETAILS_MODELS). The registration type and legal name are worked
 * out by the server.
 */
export type MerchantOnboardingPayload = {
  submit_mode: SubmitMode;
  seller_type: SellerType;
  merchant_name?: string;
  last_name?: string;
  first_name?: string;
  middle_name?: string;
  suffix?: NameSuffix | "";
  sex?: Sex | "";
  /** YYYY-MM-DD. */
  birth_date?: string;
  rep_last_name?: string;
  rep_first_name?: string;
  rep_middle_name?: string;
  rep_suffix?: NameSuffix | "";
  company_name?: string;
  trade_name?: string;
  registration_number?: string;
  tin?: string | null;
  vat_status?: VatStatus | null;
  small_agri_producer?: boolean | null;
  terms_accepted?: boolean;
  terms_version?: string;
  contact_email: string;
  contact_number: string;
  region: string;
  province: string;
  city?: string;
  barangay?: string;
  address: string;
  postal_code?: string;
  // Farm map pin (U1c), optional.
  lat?: number | null;
  lng?: number | null;
  /** The person placed or moved the pin themselves; false = only where the address geocoded to. */
  pin_confirmed?: boolean;
  available_days: string[];
  rsbsa_number?: string;
  gov_id_type?: GovIdType;
  phone_verification_token?: string;
  email_verification_token?: string;
};

/** Valid government IDs (backend GovIdType). RSBSA is a separate upload. */
export const GOV_ID_TYPES = [
  "PhilSys National ID",
  "Passport",
  "Driver's License",
  "UMID",
  "SSS",
  "PRC",
  "Postal ID",
  "Voter's ID",
  "PhilHealth",
  "Senior Citizen ID",
  "PWD ID",
] as const;
export type GovIdType = (typeof GOV_ID_TYPES)[number];

export type ShopPage = {
  id: number;
  merchant_id: number;
  title: string;
  slug: string;
  banner_image_url: string | null;
  logo_url: string | null;
  description: string | null;
};

/** The owner's view: the live page plus the unpublished draft. */
export type MyShopPage = ShopPage & {
  draft_title: string;
  draft_description: string | null;
  draft_logo_url: string | null;
  draft_banner_image_url: string | null;
  /** Time of the last publish. null: buyers cannot see the shop yet. */
  published_at: string | null;
  is_published: boolean;
  has_unpublished_changes: boolean;
};

export type MerchantPerformance = {
  merchant_id: number;
  merchant_name: string;
  verification_status: MerchantVerificationStatus;
  rating?: number | null;
  rating_count: number;
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

/**
 * Every public farm. CF-0062: the browse page needs no listings, so the
 * default asks for the slim list (`produces` is then always []).
 */
export const fetchMerchants = async (
  { withProduce = false }: { withProduce?: boolean } = {},
): Promise<Merchant[]> => {
  const response = await apiClient.get<Merchant[]>('/merchants', {
    params: withProduce ? undefined : { include_produce: false },
  });
  return response.data;
};

export const fetchMerchantById = async (merchantId: number): Promise<Merchant> => {
  const response = await apiClient.get<Merchant>(`/merchants/${merchantId}`);
  return response.data;
};

/** The signed-in merchant's own full profile, with address and pin (CF-0048).
 *  Works before the shop page is published. */
export const fetchMyMerchant = async (): Promise<Merchant> => {
  const response = await apiClient.get<Merchant>('/merchants/me');
  return response.data;
};

export type MerchantUpdatePayload = {
  merchant_name?: string | null;
  region?: string | null;
  province?: string | null;
  city?: string | null;
  barangay?: string | null;
  address?: string | null;
  postal_code?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** The person placed or moved the pin themselves; false = only where the address geocoded to. */
  pin_confirmed?: boolean;
  contact_email?: string | null;
  // A new number needs phone_verification_token from verifyOtp (CF-0030).
  contact_number?: string | null;
  phone_verification_token?: string | null;
  available_days?: string[];
  delivery_price?: number | null;
};

export const updateMyMerchant = async (payload: MerchantUpdatePayload): Promise<Merchant> => {
  const response = await apiClient.patch<Merchant>('/merchants/me', payload);
  return response.data;
};

/** CF-0066: take no orders through `pausedUntil` (yyyy-mm-dd, Manila). */
export const pauseMyStore = async (pausedUntil: string, message: string | null): Promise<Merchant> => {
  const response = await apiClient.put<Merchant>('/merchants/me/pause', {
    paused_until: pausedUntil,
    message: message || null,
  });
  return response.data;
};

export const resumeMyStore = async (): Promise<Merchant> => {
  const response = await apiClient.delete<Merchant>('/merchants/me/pause');
  return response.data;
};

/** The documents a Submit now sends. Submit later sends none. */
export type OnboardingFiles = {
  rsbsa?: File | null;
  govId?: File | null;
  /** BIR Form 2303, registered seller types only. */
  birCert?: File | null;
  /** Selfie with ID, a camera photo (every seller type). */
  selfie?: File | null;
};

export const submitMyMerchantOnboarding = async (
  payload: MerchantOnboardingPayload,
  files: OnboardingFiles = {},
): Promise<MerchantApplication> => {
  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  if (files.rsbsa) formData.append('rsbsa_file', files.rsbsa);
  if (files.govId) formData.append('gov_id_file', files.govId);
  if (files.birCert) formData.append('bir_cert_file', files.birCert);
  if (files.selfie) formData.append('selfie_file', files.selfie);
  const response = await apiClient.post<MerchantApplication>('/merchant-onboarding/me', formData);
  return response.data;
};

/** The user's own merchant application, or null when there is none (404). */
export const fetchMyMerchantApplication = async (): Promise<MerchantApplication | null> => {
  try {
    const response = await apiClient.get<MerchantApplication>('/merchant-applications/me');
    return response.data;
  } catch (e: unknown) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw e;
  }
};

export const fetchMyMerchantPerformance = async (): Promise<MerchantPerformance> => {
  const response = await apiClient.get<MerchantPerformance>('/merchants/me/performance');
  return response.data;
};

// F1: low-stock and best-before alerts for the merchant dashboard.
export type StockAlertItem = {
  id: number;
  name: string;
  unit: string;
  stock_quantity: number;
  best_before: string | null;
  days_left: number | null;
};

export type StockAlerts = {
  low_stock_threshold: number;
  expiry_warning_days: number;
  low_stock: StockAlertItem[];
  expiring_soon: StockAlertItem[];
  expired: StockAlertItem[];
};

export const fetchMyStockAlerts = async (): Promise<StockAlerts> => {
  const response = await apiClient.get<StockAlerts>('/merchants/me/stock-alerts');
  return response.data;
};

export const updateMyLowStockThreshold = async (low_stock_threshold: number): Promise<StockAlerts> => {
  const response = await apiClient.patch<StockAlerts>('/merchants/me/stock-alerts', { low_stock_threshold });
  return response.data;
};

// F2: sales charts on the merchant dashboard.
export type MerchantSales = {
  days: number;
  total_revenue: number;
  total_orders: number;
  daily: { date: string; revenue: number; orders: number }[];
  top_products: { produce_id: number | null; name: string; quantity: number; revenue: number }[];
};

/** CF-0055: CSV of the merchant's sales lines; through apiClient so the Bearer token is sent. */
export const downloadMySalesCsv = async (days: 7 | 30 | 90): Promise<void> => {
  const res = await apiClient.get<Blob>('/merchants/me/sales/export', { params: { days }, responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `sales-${days}d.csv`;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const fetchMySales = async (days: 30 | 90): Promise<MerchantSales> => {
  const response = await apiClient.get<MerchantSales>('/merchants/me/sales', { params: { days } });
  return response.data;
};

// F3: demand insight (most ordered / searched in the merchant's province).
export type DemandSearchedTerm = { query: string; searches: number; no_result_searches: number };

export type DemandInsight = {
  province: string;
  days: number;
  most_ordered: { name: string; orders: number; quantity: number }[];
  most_searched: DemandSearchedTerm[];
  most_searched_luzon: DemandSearchedTerm[];
};

export const fetchMyDemand = async (): Promise<DemandInsight> => {
  const response = await apiClient.get<DemandInsight>('/merchants/me/demand');
  return response.data;
};

/**
 * Text the code that confirms closing the merchant profile; returns the last 4
 * digits it went to. The backend checks the password first when the account
 * has one (the same steps as deleting the account).
 */
export const sendMerchantDeleteCode = async (password?: string): Promise<string> => {
  const response = await apiClient.post<{ sent_to: string }>('/merchants/me/delete-code', { password: password ?? null });
  return response.data.sent_to;
};

/** Close the merchant profile, confirmed with the code from sendMerchantDeleteCode. */
export const deleteMyMerchant = async (code: string): Promise<void> => {
  await apiClient.delete('/merchants/me', { data: { code } });
};

export const fetchMerchantShopPage = async (merchantId: number): Promise<ShopPage> => {
  const response = await apiClient.get<ShopPage>(`/merchants/${merchantId}/shoppage`);
  return response.data;
};

// The owner's shop page routes edit a draft. Buyers see it only after publish.

export const fetchMyShopPage = async (): Promise<MyShopPage> => {
  const response = await apiClient.get<MyShopPage>('/merchants/me/shoppage');
  return response.data;
};

export const createMyShopPage = async (payload: { title: string; slug: string; description?: string | null }): Promise<MyShopPage> => {
  const response = await apiClient.post<MyShopPage>('/merchants/me/shoppage', payload);
  return response.data;
};

export const updateMyShopPage = async (payload: {
  title?: string;
  slug?: string;
  description?: string | null;
  logo_url?: string | null;
  banner_image_url?: string | null;
}): Promise<MyShopPage> => {
  const response = await apiClient.patch<MyShopPage>('/merchants/me/shoppage', payload);
  return response.data;
};

export const publishMyShopPage = async (): Promise<MyShopPage> => {
  const response = await apiClient.post<MyShopPage>('/merchants/me/shoppage/publish');
  return response.data;
};

/** Hide the shop from buyers. The draft stays. Publish shows it again. */
export const unpublishMyShopPage = async (): Promise<MyShopPage> => {
  const response = await apiClient.post<MyShopPage>('/merchants/me/shoppage/unpublish');
  return response.data;
};

export const discardMyShopPageDraft = async (): Promise<MyShopPage> => {
  const response = await apiClient.post<MyShopPage>('/merchants/me/shoppage/discard');
  return response.data;
};

export const uploadBannerImage = async (file: File): Promise<MyShopPage> => {
  const formData = new FormData();
  formData.append('banner', file);
  const response = await apiClient.post<MyShopPage>('/merchants/me/shoppage/banner', formData);
  return response.data;
};

export const uploadShopLogo = async (file: File): Promise<MyShopPage> => {
  const formData = new FormData();
  formData.append('logo', file);
  const response = await apiClient.post<MyShopPage>('/merchants/me/shoppage/logo', formData);
  return response.data;
};

// ── Payout ────────────────────────────────────────────────────────────────────

export type PayoutType = 'bank' | 'gcash' | 'maya';

/** InstaPay settles in minutes; PESONet (used for GCash) on banking-day cycles. */
export type PayoutProvider = 'instapay' | 'pesonet';

export const PAYOUT_PROVIDER_LABELS: Record<PayoutProvider, string> = {
  instapay: 'InstaPay',
  pesonet: 'PESONet',
};

export const PAYOUT_PROVIDER_TIMING: Record<PayoutProvider, string> = {
  instapay: 'usually arrives within 20 minutes',
  pesonet: 'arrives on the next PESONet cycle (1 PM, 4 PM or 7 PM on banking days)',
};

export type PayoutInfo = {
  id: number;
  merchant_id: number;
  payout_type: PayoutType;
  /** PayMongo institution code (BIC) for bank payouts. */
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  ewallet_number: string | null;
  created_at: string;
  updated_at: string;
  /** Why payouts can't be sent here yet; null when the method is complete. */
  problem: string | null;
};

export type PayoutInstitution = { code: string; name: string };

export type AvailablePayout = {
  transaction_count: number;
  gross_amount: number;
  transfer_fee: number;
  net_amount: number;
};

export type PayoutInfoPayload = {
  payout_type: PayoutType;
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
  status: PayoutStatus;
  notes: string | null;
  released_at: string | null;
  created_at: string;
  transfer_fee: number | null;
  net_amount: number | null;
  attempts: number;
  failure_reason: string | null;
  provider_reference: string | null;
  paymongo_transfer_id: string | null;
  sent_at: string | null;
  destination_type: PayoutType | null;
  destination_name: string | null;
  destination_number: string | null;
  transfer_provider: PayoutProvider | null;
};

export type MerchantTransaction = {
  id: number;
  order_id: number;
  amount: number;
  merchant_amount: number;
  status: TransactionStatus;
  description: string | null;
  created_at: string;
  paid_at: string | null;
  order_status: OrderStatus | null;
};

export const fetchMyPayoutInfo = async (): Promise<PayoutInfo | null> => {
  const response = await apiClient.get<PayoutInfo | null>('/merchants/me/payout-info');
  return response.data;
};

/** CF-0004: text a code that confirms exactly this payout method. Returns the last 4 digits it went to. */
export const sendPayoutInfoCode = async (payload: PayoutInfoPayload): Promise<string> => {
  const response = await apiClient.post<{ sent_to: string }>('/merchants/me/payout-info/code', payload);
  return response.data.sent_to;
};

/** Saves the payout method; `code` is the SMS code sendPayoutInfoCode sent for it. */
export const updateMyPayoutInfo = async (payload: PayoutInfoPayload & { code: string }): Promise<PayoutInfo> => {
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

export const fetchPayoutInstitutions = async (): Promise<PayoutInstitution[]> => {
  const response = await apiClient.get<PayoutInstitution[]>('/merchants/me/payout-institutions');
  return response.data;
};

export const fetchMyAvailablePayout = async (): Promise<AvailablePayout> => {
  const response = await apiClient.get<AvailablePayout>('/merchants/me/payouts/available');
  return response.data;
};

export const requestPayout = async (): Promise<MerchantPayoutBatch> => {
  const response = await apiClient.post<MerchantPayoutBatch>('/merchants/me/payouts/request');
  return response.data;
};

// ── Merchant orders ────────────────────────────────────────────────────────────

export type MerchantOrder = {
  id: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  total_price: number;
  /** CF-0065: why the total can be lower than lines + delivery fee. */
  delivery_fee?: number;
  discount?: number;
  voucher_code?: string | null;
  items: Array<{ id?: string; produce?: string; quantity?: number; price?: number; unit?: string; farm?: string }>;
  delivery_address: string | null;
  ordered_at: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  shipped: boolean;
  time_of_arrival: string | null;
  shipment_id?: number | null;
  shipped_at?: string | null;
  auto_confirm_at?: string | null;
  // What the buyer asked for at checkout; null on orders placed before scheduling.
  requested_delivery_date: string | null; // YYYY-MM-DD
  delivery_window: string | null; // e.g. "08:00 – 10:00"
  notes: string | null;
  /** Why it was cancelled, as the buyer was told. */
  cancel_reason?: string | null;
  /**
   * ORDER_PROOF_PHOTOS_PLAN.md: a packing photo (taken in the merchant app) is needed before
   * an order ships, alone or on a route.
   */
  packing_photo?: boolean;
};

export const fetchMyMerchantOrders = async (): Promise<MerchantOrder[]> => {
  const response = await apiClient.get<MerchantOrder[]>('/merchants/me/orders');
  return response.data;
};

export const updateMerchantOrderStatus = async (orderId: number, status: Exclude<OrderStatus, "cancelled">): Promise<MerchantOrder> => {
  const response = await apiClient.patch<MerchantOrder>(`/merchants/me/orders/${orderId}/status`, { status });
  return response.data;
};

// Same keys as MERCHANT_CANCEL_REASONS in backend/app/services/order_status.py.
export const MERCHANT_CANCEL_REASONS = [
  { key: "out_of_stock", label: "Out of stock" },
  { key: "quality", label: "Produce didn't meet quality standards" },
  { key: "cannot_deliver", label: "Can't deliver to this address or date" },
  { key: "buyer_request", label: "The buyer asked to cancel" },
  { key: "buyer_not_home", label: "The buyer was not at the address" },
  { key: "other", label: "Other" },
] as const;
export type MerchantCancelReason = (typeof MERCHANT_CANCEL_REASONS)[number]["key"];
// Backend ATTEMPT_ONLY_CANCEL_REASONS: only the merchant app sends these, with a failed
// drop-off photo (ORDER_PROOF_PHOTOS_PLAN.md). The web cancel form does not offer them.
export const WEB_CANCEL_REASONS = MERCHANT_CANCEL_REASONS.filter((r) => r.key !== "buyer_not_home");
export const MERCHANT_CANCEL_NOTE_MAX = 300;

/** Cancel with the reason the buyer is told; "other" needs a note. */
export const cancelMerchantOrder = async (
  orderId: number,
  reason: MerchantCancelReason,
  note: string,
): Promise<MerchantOrder> => {
  const response = await apiClient.patch<MerchantOrder>(`/merchants/me/orders/${orderId}/status`, {
    status: "cancelled",
    cancel_reason: reason,
    cancel_note: note.trim() || null,
  });
  return response.data;
};

export type MerchantShipmentWaypoint = {
  lat: number;
  lng: number;
  label: string;
  type: 'pickup' | 'delivery';
  sequence: number;
  order_id?: number | null;
  status?: string | null;
};

export type MerchantShipmentStop = {
  sequence: number;
  order_id: number;
  buyer_name: string | null;
  delivery_address: string | null;
  lat: number;
  lng: number;
  label: string;
  status: string;
};

export type MerchantShipmentTracking = {
  shipment_id: number;
  order_id: number;
  merchant_name: string;
  status: string;
  order_ids: number[];
  waypoints: MerchantShipmentWaypoint[];
  stops: MerchantShipmentStop[];
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  progress: number;
  eta_minutes: number | null;
  active_stop_index: number;
  /** On create: orders left out because they could not be routed; they stay ready to ship. */
  skipped_orders?: { order_id: number; reason: 'no_location' | 'no_road' }[];
};

// Must match MAX_SHIPMENT_ORDERS in backend/app/schemas/shipment.py.
export const MAX_SHIPMENT_ORDERS = 20;

export const createMerchantShipment = async (orderIds: number[]): Promise<MerchantShipmentTracking> => {
  const response = await apiClient.post<MerchantShipmentTracking>('/merchants/me/shipments', { order_ids: orderIds });
  return response.data;
};

export type MerchantShipmentSummary = {
  id: number;
  status: string;
  stop_count: number;
  // Stops whose order is delivered or cancelled; equals stop_count once the run is done.
  completed_stop_count: number;
  created_at: string;
  shipped_at: string | null;
};

export const fetchMyShipments = async (): Promise<MerchantShipmentSummary[]> => {
  const response = await apiClient.get<MerchantShipmentSummary[]>('/merchants/me/shipments');
  return response.data;
};

export const fetchmMerchantShipmentTracking = async (shipmentId: number) => {
  const response = await apiClient.get<MerchantShipmentTracking | null>(`/shipments/${shipmentId}`);
  return response.data as MerchantShipmentTracking;
};

// Favourite farms (U4).
export const fetchMyFollows = async (): Promise<number[]> => {
  const response = await apiClient.get<number[]>('/users/me/follows');
  return response.data;
};

export const followFarm = async (merchantId: number): Promise<void> => {
  await apiClient.put(`/merchants/${merchantId}/follow`);
};

export const unfollowFarm = async (merchantId: number): Promise<void> => {
  await apiClient.delete(`/merchants/${merchantId}/follow`);
};

/** One order chat in the farm's chat list (GET /merchants/me/chats). */
export type MerchantChatSummary = {
  order_id: number;
  order_ref: string;
  order_status: OrderStatus;
  buyer_name: string | null;
  closed: boolean;
  last_body: string;
  last_sender_role: string;
  last_mine: boolean;
  last_at: string;
  unread: number;
};

export const fetchMyMerchantChats = async (): Promise<MerchantChatSummary[]> => {
  const response = await apiClient.get<MerchantChatSummary[]>('/merchants/me/chats');
  return response.data;
};

/** Questions buyers sent the farm before (or without) ordering. */
export const fetchMyMerchantInquiries = async (): Promise<InquirySummary[]> => {
  const response = await apiClient.get<InquirySummary[]>('/merchants/me/inquiries');
  return response.data;
};

/** The farm's side of an inquiry thread: GET to read, POST to reply. */
export const inquiryEndpoint = (conversationId: number) => `/inquiries/${conversationId}/messages`;
