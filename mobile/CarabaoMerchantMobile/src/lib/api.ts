// Merchant API client (plan §2.3/§2.4, sections S3, S7 and S11): the HTTP client from the
// buyer app, the methods the merchant screens call, and the one the root gate needs
// (api.users.me). Buyer-only groups are left out (decision D3), except `support`: the
// order-chat screen keeps the buyer's `support=1` branch (S11) and the endpoint is shared.
// This file is not in sharedCopies.test.ts.
import type { MyMerchantReviews, MyReview } from './myReviews';
import type { ChatSummary, InquirySummary } from './chatInbox';
import type { DemandInsight, MerchantPerformance } from './dashboard';
// S10: the day counts the sales summary and the CSV export accept (pure, so the tests can read
// them without React Native); see src/lib/payout.ts.
import type { ExportDays, SalesDays } from './payout';

// S12: the road line GET /shipments/{id}/route answers, typed so the map helper can read it.
import type { RouteGeoJSON } from './routeMap';

import { getAccessToken } from './authClient';
import { chatEndpoint } from './orderChat';
import { emitSessionExpired, sessionGone } from './sessionEvents';
import { parseErrorBody } from './apiErrors';
import { contentTypeFor, type FilePart } from './uploads';
import { API_BASE } from './config';
import { UNREAD_COUNT_QUERY } from './polling';

export { API_BASE, WEB_BASE } from './config';

const REQUEST_TIMEOUT_MS = 20000;

export class ApiError extends Error {
  // CF-0123: message per form field from the server (src/lib/apiErrors.ts), {} when none.
  constructor(message: string, public status: number, public fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

// S10: a CSV export answers text/csv, everything else answers JSON. `as` picks the parser; the
// JSON path and its error words are unchanged.
export type ResponseMode = 'json' | 'text';

// `token` says whether the call is signed in (screens pass the one from useAuth).
// The header always carries a current token: they last 15 minutes, so an older
// one is swapped for a fresh one, and a 401 gets one retry with a new token.
export async function request<T>(
  path: string,
  token: string | null,
  options?: RequestInit,
  as: ResponseMode = 'json',
): Promise<T> {
  if (!token) return send<T>(path, null, options, as);
  try {
    return await send<T>(path, (await getAccessToken()) ?? token, options, as);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) throw err;
    const fresh = await getAccessToken({ forceRefresh: true });
    // CF-0120: no new token, or a 401 again with a new one: the session is gone.
    // Tell the auth layer once; it signs out and protected screens go to sign-in.
    if (!fresh) {
      emitSessionExpired();
      throw err;
    }
    try {
      return await send<T>(path, fresh, options, as);
    } catch (again) {
      if (again instanceof ApiError && sessionGone(again.status, true, true)) emitSessionExpired();
      throw again;
    }
  }
}

/** The one "wrong host" message, for a body that is not the JSON (or CSV) this app expects. */
function unexpectedResponse(path: string, status: number): ApiError {
  return new ApiError(
    `Unexpected response from ${API_BASE}${path} (${status}). Is EXPO_PUBLIC_API_URL the FastAPI backend?`,
    status,
  );
}

async function send<T>(
  path: string,
  token: string | null,
  options?: RequestInit,
  as: ResponseMode = 'json',
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // S2: JSON only for a string body. A FormData body goes without a Content-Type, so
  // fetch writes multipart/form-data with the boundary it generated.
  const contentType = contentTypeFor(options?.body);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: as === 'text' ? 'text/csv' : 'application/json',
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((options?.headers as Record<string, string>) ?? {}),
      },
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new ApiError(
      aborted
        ? 'The server took too long to respond. Please try again.'
        : `Could not reach the server at ${API_BASE}. Check your connection.`,
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: unknown = null;
  let json = false;
  if (text) {
    try {
      body = JSON.parse(text);
      json = true;
    } catch {
      // S10: the CSV export is the one endpoint that answers something other than JSON. An
      // error still comes back as JSON, so a text-mode body that is not JSON is passed through.
      if (as === 'json') throw unexpectedResponse(path, res.status);
    }
  }
  if (!res.ok) {
    // Non-JSON (usually an HTML page) means API_BASE points at the wrong host.
    if (text && !json) throw unexpectedResponse(path, res.status);
    const parsed = parseErrorBody(body);
    throw new ApiError(parsed.message ?? `Request failed (${res.status})`, res.status, parsed.fields);
  }
  return (as === 'text' ? text : body) as T;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type ApiUserProfile = {
  id: number;
  // Identity, read live from BetterAuth. email is null for a phone signup
  // that hasn't added one; phone_number is "+639XXXXXXXXX".
  name: string | null;
  email: string | null;
  email_verified: boolean;
  phone_number: string | null;
  phone_verified: boolean;
  created_at: string | null;
  // The gate reads this: null means the account has no farm yet.
  merchant: { id: number; merchant_name: string } | null;
  // Not read in this app; the backend still sends them for a buyer account.
  cart?: { id: number; total_items: number; total_price: number } | null;
  // Saved delivery addresses, default first.
  addresses?: ApiUserAddress[];
  notifications_preferences?: Record<string, unknown> | null;
};

export type ApiUserAddress = {
  id: number;
  label: string | null;
  region: string | null;
  province: string | null;
  city: string | null;
  barangay: string | null;
  address: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  is_default: boolean;
};

export type ApiMerchant = {
  id: number;
  merchant_name: string;
  // CF-0128 (M34): backend PublicMerchantResponse (CF-0048) leaves out the street
  // address and barangay on the public farm routes, and the number can be null.
  address?: string | null;
  barangay?: string | null;
  city: string | null;
  province: string | null;
  contact_number: string | null;
  operating_hours: string | null;
  delivery_price: number | null;
  delivery_time: number | null;
  rating: number | null;
  // CF-0066 holiday mode (shown by M57).
  paused_until?: string | null;
  pause_message?: string | null;
  produces: ApiProduce[];
  shop_page: {
    id: number;
    title: string;
    slug: string;
    banner_image_url: string | null;
    logo_url?: string | null;
    description: string | null;
  } | null;
};

export type ApiProduce = {
  id: number;
  merchant_id: number;
  name: string | null;
  description: string | null;
  category: string | null;
  price: number;
  unit: string;
  unit_quantity?: number;
  stock_quantity: number;
  image_url: string | null;
  // ISO dates (YYYY-MM-DD); null on listings created before they were collected.
  harvest_date: string | null;
  best_before: string | null;
  min_order_qty: number;
  // Unit price once a cart line reaches min_qty; the server applies it.
  price_tiers: { min_qty: number; unit_price: number }[];
  // Set when an admin hides the listing; only the merchant's own list has it.
  hidden_at?: string | null;
  hidden_reason?: string | null;
};

// Mirrors backend ProduceCreate / ProduceUpdate (app/schemas/produce.py).
export type ProduceCategory = 'Vegetables' | 'Fruits';
export type ProduceUnit = 'kg' | 'lbs';

export type ProduceCreatePayload = {
  name: string;
  description?: string | null;
  category?: ProduceCategory | null;
  price: number;
  unit?: ProduceUnit;
  unit_quantity?: number;
  stock_quantity?: number;
  image_url?: string | null;
  // YYYY-MM-DD. Required by the backend on create and checked on every edit (CF-0107).
  harvest_date?: string | null;
  best_before?: string | null;
  // CF-0116: backend checks these with produce_pricing.pricing_error.
  min_order_qty?: number;
  price_tiers?: { min_qty: number; unit_price: number }[];
};

export type ProduceUpdatePayload = Partial<{
  [K in keyof ProduceCreatePayload]: ProduceCreatePayload[K] | null;
}> & {
  // CF-0049: the stock the screen loaded. If an order changed it since (a checkout or a
  // cancel), the server answers 409 instead of overwriting that change; left out when a
  // payload does not send stock at all.
  expected_stock_quantity?: number | null;
};

export type MerchantOrderStatus =
  | 'pending' | 'processing' | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled';

// Mirrors backend MerchantOrderResponse (app/schemas/payout.py). Merchants only
// receive orders a payment has landed on.
export type ApiMerchantOrder = {
  id: number;
  status: MerchantOrderStatus;
  payment_status: 'awaiting_payment' | 'paid' | 'refund_pending' | 'refunded' | 'unpaid';
  total_price: number;
  // A checkout snapshot: produce/name (the listing's name), unit, price and quantity
  // (backend api/routes/_order_helpers.py order_line).
  items: {
    name?: string;
    produce?: string;
    unit?: string;
    quantity?: number;
    price?: number;
  }[];
  delivery_address: string | null;
  ordered_at: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  shipped: boolean;
  time_of_arrival: string | null;
  requested_delivery_date: string | null;
  delivery_window: string | null;
  notes: string | null;
  // CF-0065: why a total can be lower than its lines + delivery fee.
  discount?: number;
  voucher_code?: string | null;
  // Set while the order is in transit: when the buyer's window closes (web OrderCard).
  auto_confirm_at?: string | null;
  // Why it was cancelled, as the buyer was told.
  cancel_reason?: string | null;
  // Set once the order is on a route (ready-to-ship orders have none yet).
  shipment_id: number | null;
};

// S11 (plan §5.4, part 1): one route made from ready orders. Copied from the web
// util/api/merchants.ts (MerchantShipmentTracking and MerchantShipmentSummary); the route
// screen (S12) reads the stops and waypoints, creating a route reads shipment_id, order_ids
// and skipped_orders.
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

// Why a stop was left out: the delivery location could not be found on the map, or no road
// route reaches it (the web's union and backend SkippedStop.reason).
export type ShipmentSkipReason = 'no_location' | 'no_road';

export type MerchantShipmentSkip = { order_id: number; reason: ShipmentSkipReason };

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
  skipped_orders?: MerchantShipmentSkip[];
};

// S12 (plan §5.4, part 2): one stop as the route screen reads it (web util/api/tracking.ts
// ShipmentStop). The merchant-only fields sit on top of what S11's summary carries.
export type ApiShipmentStop = MerchantShipmentStop & {
  /** Planned arrival (ISO) from the route schedule. */
  estimated_arrival_at?: string | null;
  /** The rider reported that this stop's pin could not be reached. */
  pin_unreachable?: boolean;
  /** The buyer never placed this pin; it is where their address geocoded to. */
  pin_approximate?: boolean;
};

// GET /shipments/{id}, the merchant's view of one route (web TrackingData). `origin` and
// `destination` are null in 'waiting_for_shipment'; the route screen polls until every stop is
// closed.
export type ApiShipmentTracking = Omit<MerchantShipmentTracking, 'stops'> & {
  stops: ApiShipmentStop[];
  /** Planned drive time for the whole route. */
  total_duration_seconds?: number | null;
};

// GET /shipments/{id}/route: the road line, or null when Mapbox had none (the map then shows the
// stops without a line).
export type RouteGeometryResponse = { route: RouteGeoJSON | null };

// Backend GET /merchants/me/shipments (web MerchantShipmentSummary). completed_stop_count
// counts the stops whose order is delivered or cancelled, so the two are equal once done.
export type MerchantShipmentSummary = {
  id: number;
  status: string;
  stop_count: number;
  completed_stop_count: number;
  created_at: string;
  shipped_at: string | null;
};

// The owner's shop page (backend ShopPageOwnerResponse, app/schemas/shopPage.py): the
// live page plus the unpublished draft. The endpoint is 404 until one is created.
export type ApiShopPage = {
  id: number;
  merchant_id: number;
  title: string;
  slug: string;
  banner_image_url: string | null;
  logo_url: string | null;
  description: string | null;
  draft_title: string;
  draft_description: string | null;
  draft_logo_url: string | null;
  draft_banner_image_url: string | null;
  published_at: string | null;
  is_published: boolean;
  has_unpublished_changes: boolean;
};

// S9 (plan §5.5, part 1): the payout destination, copied from the web util/api/merchants.ts.
// A change is saved only with the SMS code sent for exactly that destination (CF-0004).
export type PayoutType = 'bank' | 'gcash' | 'maya';

// Backend PayoutInfoResponse (app/schemas/payout.py). `problem` says why a payout cannot be
// sent here yet (null once the method is complete), so the screen can warn before cashing out.
export type PayoutInfo = {
  id: number;
  merchant_id: number;
  payout_type: PayoutType;
  // The PayMongo institution code (BIC) and the name looked up for it, for a bank payout.
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  ewallet_number: string | null;
  created_at: string;
  updated_at: string;
  problem: string | null;
};

// A bank on PayMongo's InstaPay list (backend ReceivingInstitution).
export type PayoutInstitution = { code: string; name: string };

// The destination a code is sent for and the save posts (backend PayoutInfoUpdate, the web
// payload()). Blank fields go as null, exactly as the web payload() sends them.
export type PayoutInfoPayload = {
  payout_type: PayoutType;
  bank_code?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  ewallet_number?: string | null;
};

// S10 (plan §5.5, part 2): the money side of Earnings - what a cash out would ask for now, the
// batches already sent, and the transactions behind them. Copied from the web
// util/api/merchants.ts, whose unions match backend app/models/statuses.py.
export type PayoutStatus = 'pending' | 'approved' | 'processing' | 'released' | 'failed';
export type PayoutProvider = 'instapay' | 'pesonet';
export type TransactionStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'refund_pending'
  | 'refunded';

// Backend AvailablePayout: the buyer-confirmed orders no payout has taken yet, and the PayMongo
// transfer fee they would pay (the fee is the provider's, so the screen shows it before cashing).
export type AvailablePayout = {
  transaction_count: number;
  gross_amount: number;
  transfer_fee: number;
  net_amount: number;
};

// Backend PayoutBatchResponse: one cash out as requested and, once released, as sent. The
// destination fields are the snapshot taken at approval (rule 7: mask before printing).
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

// Backend TransactionSummary: one payment and the farm's share of it (merchant_amount, after the
// platform fee). `order_status` is null when the order row is gone.
export type MerchantTransaction = {
  id: number;
  order_id: number;
  amount: number;
  merchant_amount: number;
  status: TransactionStatus;
  description: string | null;
  created_at: string;
  paid_at: string | null;
  order_status: MerchantOrderStatus | null;
};

// Backend MerchantSales: GET /merchants/me/sales?days=30|90, the numbers behind the sales card.
export type MerchantSales = {
  days: number;
  total_revenue: number;
  total_orders: number;
  daily: { date: string; revenue: number; orders: number }[];
  top_products: {
    produce_id: number | null;
    name: string;
    quantity: number;
    revenue: number;
  }[];
  skipped_rows: number;
};

// Stock alerts (F1), same as the web merchant dashboard.
export type ApiStockAlertItem = {
  id: number;
  name: string;
  unit: string;
  stock_quantity: number;
  best_before: string | null;
  days_left: number | null;
};

export type ApiStockAlerts = {
  low_stock_threshold: number;
  expiry_warning_days: number;
  low_stock: ApiStockAlertItem[];
  expiring_soon: ApiStockAlertItem[];
  expired: ApiStockAlertItem[];
};

// The notification centre (U5).
export type ApiNotification = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

// Order chat (CH1).
export type ApiChatMessage = {
  id: number;
  sender_role: string;
  mine: boolean;
  body: string;
  created_at: string;
};

export type ApiChatThread = {
  order_id?: number;
  my_role: string;
  closed: boolean;
  closes_at: string | null;
  messages: ApiChatMessage[];
};

// S5: a buyer's pre-order question, as the farm sees it (backend InquiryThread). Same
// messages as an order chat; `conversation_id` is null only when the buyer has none yet.
export type ApiInquiryThread = {
  conversation_id: number | null;
  merchant_id: number;
  my_role: string;
  closed: boolean;
  closes_at: string | null;
  messages: ApiChatMessage[];
};

// ── API ────────────────────────────────────────────────────────────────────────

export const api = {
  merchants: {
    // The merchant's own listings, including expired and admin-hidden ones.
    myProduce: (token: string | null) =>
      request<ApiProduce[]>('/merchants/me/produce', token),
    myOrders: (token: string | null) =>
      request<ApiMerchantOrder[]>('/merchants/me/orders', token),
    // S14: the owner's shop page, draft included. 404 until the farm creates one.
    shopPage: (token: string | null) =>
      request<ApiShopPage>('/merchants/me/shoppage', token),
    // CF-0127: the farm's order chats, newest message first.
    chats: (token: string | null) => request<ChatSummary[]>('/merchants/me/chats', token),
    // S5: buyers' pre-order questions (backend GET /merchants/me/inquiries, web
    // fetchMyMerchantInquiries), newest message first like the chats.
    inquiries: (token: string | null) => request<InquirySummary[]>('/merchants/me/inquiries', token),
    // CF-0125: dashboard numbers and province demand.
    performance: (token: string | null) => request<MerchantPerformance>('/merchants/me/performance', token),
    demand: (token: string | null) => request<DemandInsight>('/merchants/me/demand', token),
    // S10: the sales summary the Earnings card shows (30 or 90 days, web fetchMySales) and the
    // same rows as a CSV (7, 30 or 90 days). The export answers text/csv, not JSON, so request()
    // runs in text mode; GET /merchants/me/sales/export?days=... on the web does the same.
    sales: (token: string | null, days: SalesDays) =>
      request<MerchantSales>(`/merchants/me/sales?days=${days}`, token),
    salesCsv: (token: string | null, days: ExportDays) =>
      request<string>(`/merchants/me/sales/export?days=${days}`, token, undefined, 'text'),
    // CF-0119: query from src/lib/myReviews.ts myReviewsQuery.
    myReviews: (token: string | null, query: string) =>
      request<MyMerchantReviews>(`/merchants/me/reviews?${query}`, token),
    // CF-0133: the farm's one public reply; PUT writes or edits it, DELETE removes it
    // (204, also when there is none). A review an admin hid gives 404.
    setReviewReply: (token: string | null, reviewId: number, reply: string) =>
      request<MyReview>(`/merchants/me/reviews/${reviewId}/reply`, token, { method: 'PUT', body: JSON.stringify({ reply }) }),
    deleteReviewReply: (token: string | null, reviewId: number) =>
      request<null>(`/merchants/me/reviews/${reviewId}/reply`, token, { method: 'DELETE' }),
    stockAlerts: (token: string | null) =>
      request<ApiStockAlerts>('/merchants/me/stock-alerts', token),
    // S7: the farm's own low-stock threshold (web updateMyLowStockThreshold). The server
    // answers with the alerts re-ranked at the new threshold; 0 turns low-stock alerts
    // off (backend ThresholdUpdate: 0 to 100,000).
    setLowStockThreshold: (token: string | null, lowStockThreshold: number) =>
      request<ApiStockAlerts>('/merchants/me/stock-alerts', token, {
        method: 'PATCH',
        body: JSON.stringify({ low_stock_threshold: lowStockThreshold }),
      }),
    updateOrderStatus: (token: string | null, orderId: number, status: Exclude<MerchantOrderStatus, 'cancelled'>) =>
      request<ApiMerchantOrder>(`/merchants/me/orders/${orderId}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    // Cancelling needs a reason (src/components/CancelOrderSheet.tsx); "other" needs a note.
    cancelOrder: (token: string | null, orderId: number, reason: string, note: string) =>
      request<ApiMerchantOrder>(`/merchants/me/orders/${orderId}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled', cancel_reason: reason, cancel_note: note.trim() || null }),
      }),
    // S11: one route from ready orders (backend POST /merchants/me/shipments, the web
    // createMerchantShipment). The server leaves out the stops it cannot route and names them
    // in `skipped_orders`; a 400 names the orders it refused. A 429 is the `shipment_create`
    // limit (30 an hour per farm) and its message is the one the screen shows.
    createShipment: (token: string | null, orderIds: number[]) =>
      request<MerchantShipmentTracking>('/merchants/me/shipments', token, {
        method: 'POST',
        body: JSON.stringify({ order_ids: orderIds }),
      }),
    // The farm's shipments, newest first (web fetchMyShipments).
    shipments: (token: string | null) =>
      request<MerchantShipmentSummary[]>('/merchants/me/shipments', token),
  },
  // S12: one created route, as the route screen reads it (web util/api/tracking.ts). The map's
  // road line is its own call, because the server caches Mapbox's answer and the stops do not
  // change when it fails.
  shipments: {
    tracking: (token: string | null, shipmentId: number) =>
      request<ApiShipmentTracking>(`/shipments/${shipmentId}`, token),
    route: (token: string | null, shipmentId: number) =>
      request<RouteGeometryResponse>(`/shipments/${shipmentId}/route`, token),
    // The rider could not get to this stop's pin (pin quality, control 6). 204 on success; an
    // optional note (200 characters, backend PinUnreachableRequest) is kept for the buyer. 409
    // means it was already reported, which the screen shows as done (the web does the same).
    reportUnreachablePin: (token: string | null, orderId: number, note?: string) =>
      request<null>(`/merchants/me/orders/${orderId}/pin-unreachable`, token, {
        method: 'POST',
        body: JSON.stringify({ note: note?.trim() || null }),
      }),
  },
  // S9 (plan §5.5, part 1): the payout destination - the web's payoutInfo, payoutInstitutions,
  // sendPayoutInfoCode and updateMyPayoutInfo. The server saves a change only with the SMS code
  // sent for exactly that destination (CF-0004), so sendCode first, then update with the code.
  // S10 adds the balance, cash out, history and sales to this group.
  payout: {
    // null until the farm sets a method up.
    info: (token: string | null) => request<PayoutInfo | null>('/merchants/me/payout-info', token),
    // PayMongo's InstaPay list; 502 when it cannot be reached.
    institutions: (token: string | null) =>
      request<PayoutInstitution[]>('/merchants/me/payout-institutions', token),
    // Texts a code to the account's verified mobile number. The server answers with the last 4
    // digits it went to (PayoutCodeSent.sent_to) and never the whole number.
    sendCode: (token: string | null, payload: PayoutInfoPayload) =>
      request<{ sent_to: string }>('/merchants/me/payout-info/code', token, {
        method: 'POST',
        body: JSON.stringify(payload),
      }).then((res) => res.sent_to),
    // 400 (wrong or expired code, unverified number), 422 (incomplete details), 429 (too many
    // codes): src/lib/payout.ts payoutSaveMessage says which words the screen shows for each.
    update: (token: string | null, payload: PayoutInfoPayload & { code: string }) =>
      request<PayoutInfo>('/merchants/me/payout-info', token, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    // S10: what a cash out would ask for now (web fetchMyAvailablePayout).
    availablePayout: (token: string | null) =>
      request<AvailablePayout>('/merchants/me/payouts/available', token),
    // Asks for everything available. 400 carries the server's reason (a payout already open,
    // nothing to cash out, under the transfer fee, over PayMongo's limit); 403 the farm is not
    // verified. src/lib/payout.ts payoutRequestMessage picks the words for the screen.
    requestPayout: (token: string | null) =>
      request<MerchantPayoutBatch>('/merchants/me/payouts/request', token, { method: 'POST' }),
    // The farm's cash outs, newest first (web fetchMyPayouts).
    payouts: (token: string | null) =>
      request<MerchantPayoutBatch[]>('/merchants/me/payouts', token),
    // The payments behind those numbers, newest first (web fetchMyTransactions).
    transactions: (token: string | null) =>
      request<MerchantTransaction[]>('/merchants/me/transactions', token),
  },
  produce: {
    create: (token: string | null, payload: ProduceCreatePayload) =>
      request<ApiProduce>('/produce/', token, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (token: string | null, produceId: number, payload: ProduceUpdatePayload) =>
      request<ApiProduce>(`/produce/${produceId}`, token, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    // CF-0116: the owner deletes a listing (backend DELETE /produce/{id}).
    remove: (token: string | null, produceId: number) =>
      request<null>(`/produce/${produceId}`, token, { method: 'DELETE' }),
    // S6: the listing's photo (backend POST /produce/{produce_id}/image). The part name is
    // `image`, the same as the web uploadProduceImage (util/api/produce.ts), and the
    // FormData body goes without a JSON Content-Type (see send() above).
    uploadImage: (token: string | null, produceId: number, file: FilePart) => {
      const form = new FormData();
      // React Native's FormData takes { uri, name, type } as the file part.
      form.append('image', file as unknown as Blob);
      return request<ApiProduce>(`/produce/${produceId}/image`, token, { method: 'POST', body: form });
    },
  },
  // S11: the order-chat screen keeps the buyer's support branch (`support=1`); the endpoint
  // is the same for both apps (backend api/routes/support_chat.py). Every path below comes
  // from orderChat.chatEndpoint, so the screen's three threads and their URLs cannot drift.
  support: {
    thread: (token: string | null, afterId = 0) =>
      request<ApiChatThread>(`${chatEndpoint({ kind: 'support' })}?after_id=${afterId}`, token),
    send: (token: string | null, body: string) =>
      request<ApiChatMessage>(chatEndpoint({ kind: 'support' }), token, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
  },
  chat: {
    thread: (token: string | null, orderId: number, afterId = 0) =>
      request<ApiChatThread>(`${chatEndpoint({ kind: 'order', orderId })}?after_id=${afterId}`, token),
    send: (token: string | null, orderId: number, body: string) =>
      request<ApiChatMessage>(chatEndpoint({ kind: 'order', orderId }), token, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
  },
  // S5: the farm answers a buyer's pre-order question (backend
  // GET/POST /inquiries/{conversation_id}/messages, web inquiryEndpoint). Reading marks it
  // read for the farm, exactly like an order chat.
  inquiry: {
    thread: (token: string | null, conversationId: number, afterId = 0) =>
      request<ApiInquiryThread>(
        `${chatEndpoint({ kind: 'inquiry', conversationId })}?after_id=${afterId}`,
        token,
      ),
    send: (token: string | null, conversationId: number, body: string) =>
      request<ApiChatMessage>(chatEndpoint({ kind: 'inquiry', conversationId }), token, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
  },
  notifications: {
    // CF-0117: the bell needs only the count; one unread row instead of the whole page.
    unreadCount: (token: string | null) =>
      request<{ items: ApiNotification[]; unread: number }>(`/users/me/notifications?${UNREAD_COUNT_QUERY}`, token)
        .then((r) => r.unread),
    markRead: (token: string | null, id: number) =>
      request<null>(`/users/me/notifications/${id}/read`, token, { method: 'POST' }),
    markAllRead: (token: string | null) =>
      request<null>('/users/me/notifications/read-all', token, { method: 'POST' }),
    // CF-0121: paging, unread filter, unread / delete (web util/api/notifications.ts).
    page: (token: string | null, query: string) =>
      request<{ items: ApiNotification[]; unread: number; total: number }>(`/users/me/notifications?${query}`, token),
    markUnread: (token: string | null, id: number) =>
      request<null>(`/users/me/notifications/${id}/unread`, token, { method: 'POST' }),
    remove: (token: string | null, id: number) =>
      request<null>(`/users/me/notifications/${id}`, token, { method: 'DELETE' }),
    removeRead: (token: string | null) =>
      request<null>('/users/me/notifications/read', token, { method: 'DELETE' }),
  },
  users: {
    me: (token: string | null) =>
      request<ApiUserProfile>('/users/me', token),
  },
};
