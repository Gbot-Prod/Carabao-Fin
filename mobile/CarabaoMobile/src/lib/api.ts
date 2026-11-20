import type { ApiReferencePrice } from './referencePrices';

import { getAccessToken } from './authClient';
import { emitSessionExpired, sessionGone } from './sessionEvents';
import { parseErrorBody } from './apiErrors';
import { API_BASE } from './config';
import { historyQueryString, type HistoryQuery } from './orderHistory';
import type { ServerCartLine } from './cartSync';
import type { AddressPayload } from './addresses';
import type { MerchantReviews, MyMerchantReviews, MyReview } from './reviews';
import type { DemandInsight, MerchantPerformance } from './dashboard';
import type { ChatSummary } from './chatInbox';
import type { VoucherPreview } from './vouchers';
import type { NotificationPrefs } from './notificationPrefs';
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

// `token` says whether the call is signed in (screens pass the one from useAuth).
// The header always carries a current token: they last 15 minutes, so an older
// one is swapped for a fresh one, and a 401 gets one retry with a new token.
export async function request<T>(
  path: string,
  token: string | null,
  options?: RequestInit,
): Promise<T> {
  if (!token) return send<T>(path, null, options);
  try {
    return await send<T>(path, (await getAccessToken()) ?? token, options);
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
      return await send<T>(path, fresh, options);
    } catch (again) {
      if (again instanceof ApiError && sessionGone(again.status, true, true)) emitSessionExpired();
      throw again;
    }
  }
}

async function send<T>(
  path: string,
  token: string | null,
  options?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
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
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON (usually an HTML page) means API_BASE points at the wrong host.
      throw new ApiError(
        `Unexpected response from ${API_BASE}${path} (${res.status}). Is EXPO_PUBLIC_API_URL the FastAPI backend?`,
        res.status,
      );
    }
  }
  if (!res.ok) {
    const parsed = parseErrorBody(body);
    throw new ApiError(parsed.message ?? `Request failed (${res.status})`, res.status, parsed.fields);
  }
  return body as T;
}

// ── Types ──────────────────────────────────────────────────────────────────────

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
}>;

export type ApiCurrentOrder = {
  id: number;
  order_id: number;
  merchant: string;
  merchant_id: number | null;
  shipped: boolean;
  date_bought: string;
  time_of_arrival: string | null;
  delivery_fee: number;
  image: string | null;
  status: string;
};

export type ApiHistoryOrder = {
  id: number;
  order_id: number;
  merchant: string;
  merchant_id: number | null;
  total_amount: number;
  order_date: string;
  status: string;
  items: ApiCartItem[];
};

// GET /orders/me/{id} (backend OrderDetailResponse). CF-0105.
export type ApiOrderReview = {
  id: number;
  rating: number; // 1-5
  comment: string | null;
  reviewer_name: string;
  created_at: string;
  updated_at: string;
  editable_until: string | null;
  // CF-0128 (M62): backend ReviewResponse. `hidden`: an admin hid it (CF-0078).
  merchant_reply?: string | null;
  merchant_replied_at?: string | null;
  hidden?: boolean;
};

export type ApiOrderDetail = {
  id: number;
  order_id: number;
  merchant: string;
  merchant_id: number | null;
  shipped: boolean;
  date_bought: string;
  time_of_arrival: string | null;
  shipped_at: string | null;
  auto_confirm_at: string | null;
  delivery_fee: number;
  status: string;
  payment_status: string;
  items: ApiCartItem[];
  total_amount: number; // already net of the discount
  // CF-0128 (M61): farm voucher on this order (backend CF-0064).
  discount?: number;
  voucher_code?: string | null;
  delivery_address: string | null;
  requested_delivery_date: string | null;
  delivery_window: string | null;
  notes: string | null;
  delivered_at: string | null;
  delivery_confirmed_by: string | null;
  review: ApiOrderReview | null;
  can_review: boolean;
  review_deadline: string | null;
};

// CF-0135 (M54): the buyer's receipt for a paid order (backend schemas/receipt.py, web OrderReceipt).
export type ApiReceiptLine = {
  name: string;
  unit: string | null;
  quantity: number;
  unit_price: number; // whole pesos
  line_total: number;
};

export type ApiReceipt = {
  receipt_number: string;
  order_id: number;
  order_status: string;
  ordered_at: string | null;
  paid_at: string | null;
  payment_status: string; // paid | refund_pending | refunded
  payment_reference: string | null;
  buyer_name: string | null;
  farm_name: string | null;
  farm_town: string | null;
  farm_contact_number: string | null;
  delivery_address: string | null;
  requested_delivery_date: string | null;
  delivery_window: string | null;
  lines: ApiReceiptLine[];
  subtotal: number;
  delivery_fee: number;
  discount?: number;
  voucher_code?: string | null;
  total: number;
};

export type ApiCartItem = {
  id: string;
  farm: string;
  produce: string;
  unit: string;
  quantity: number;
  price: number;
};

export type ApiUserProfile = {
  id: number;
  // Identity, read live from BetterAuth. email is null for a phone signup
  // that hasn't added one; phone_number is "+639XXXXXXXXX".
  name: string | null;
  email: string | null;
  email_verified: boolean;
  phone_number: string | null;
  // Checkout, merchant applications and order chat need this.
  phone_verified: boolean;
  created_at: string | null;
  merchant: { id: number; merchant_name: string } | null;
  cart: { id: number; total_items: number; total_price: number } | null;
  // Saved delivery addresses, default first.
  addresses: ApiUserAddress[];
  // Raw stored switches; read them with readNotificationPrefs (CF-0132).
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

/** The default saved address, else the first, else null. */
export function defaultAddress(addresses: ApiUserAddress[] | null | undefined): ApiUserAddress | null {
  return addresses?.find((a) => a.is_default) ?? addresses?.[0] ?? null;
}

// The server-side cart (GET/PUT /carts/me). /orders/me/place reads this cart,
// not the request body. Line shape: src/lib/cartSync.ts ServerCartLine (CF-0109).
export type ApiCart = {
  id: number;
  user_id: number;
  items: ServerCartLine[];
  total_items: number;
  total_price: number;
};

export function merchantLocation(m: Pick<ApiMerchant, 'city' | 'province'>): string {
  return [m.city, m.province].filter(Boolean).join(', ');
}

export type PlaceOrderPayload = {
  // YYYY-MM-DD, today .. +30 days (CF-0115); shown to the farm as the requested day.
  delivery_date?: string | null;
  delivery_address?: string | null;
  // From a saved address (CF-0110): the server checks the region is in Luzon.
  delivery_region?: string;
  delivery_lat?: number;
  delivery_lng?: number;
  delivery_time?: string | null;
  notes?: string | null;
  // CF-0131: one farm voucher code (≤ 40); the server works out the discount.
  voucher_code?: string | null;
};

export type { VoucherPreview };

export type PlacedOrder = {
  order_id: number;
  order_reference: string;
  status: string;
  merchant_id: number;
  merchant_name: string;
  total_price: number;
  delivery_fee: number;
};

export type PlaceOrderResponse = {
  // The first order; `orders` lists one per farm in the cart (C1).
  order_id: number;
  order_reference: string;
  status: string;
  orders?: PlacedOrder[];
};

// Mirrors backend TransactionStatus (app/models/statuses.py).
export type TransactionStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'refund_pending'
  | 'refunded';

export type CheckoutSessionResponse = {
  transaction_id: number;
  order_id: number;
  checkout_url: string;
  paymongo_session_id: string;
  amount: number;
  status: TransactionStatus;
};

export type TransactionStatusResponse = {
  id: number;
  order_id: number;
  status: TransactionStatus;
  amount: number;
  platform_fee: number;
  merchant_amount: number;
  paid_at: string | null;
};

// Progress and ETA are estimated from the planned route schedule; there is no
// live vehicle location. 'waiting_for_shipment' means no route yet, so no ETA.
export type ApiTracking = {
  shipment_id: number;
  order_id: number;
  status: string;
  progress: number;
  eta_minutes: number | null;
  tracking_state: 'estimated' | 'waiting_for_shipment';
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
  items: { name?: string; produce_name?: string; quantity?: number; price?: number }[];
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
  // Why it was cancelled, as the buyer was told.
  cancel_reason?: string | null;
};

// GET /produce/search (U2).
export type ApiProduceSearchResult = ApiProduce & {
  merchant_name: string;
  merchant_province: string | null;
  merchant_city: string | null;
};

export type ApiPage<T> = { items: T[]; total: number; page: number; page_size: number };

// Saved produce (CF-0038 backend, CF-0104 mobile): backend SavedProduceResponse.
export type ApiSavedProduce = ApiProduceSearchResult & { saved_at: string };

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

// ── API ────────────────────────────────────────────────────────────────────────

export const api = {
  merchants: {
    list: (token: string | null) =>
      request<ApiMerchant[]>('/merchants', token),
    get: (id: number, token: string | null) =>
      request<ApiMerchant>(`/merchants/${id}`, token),
    produce: (id: number, token: string | null) =>
      request<ApiProduce[]>(`/merchants/${id}/produce`, token),
    // The merchant's own listings, including expired and admin-hidden ones.
    myProduce: (token: string | null) =>
      request<ApiProduce[]>('/merchants/me/produce', token),
    myOrders: (token: string | null) =>
      request<ApiMerchantOrder[]>('/merchants/me/orders', token),
    // CF-0127: the farm's order chats, newest message first.
    chats: (token: string | null) => request<ChatSummary[]>('/merchants/me/chats', token),
    // CF-0125: dashboard numbers and province demand.
    performance: (token: string | null) => request<MerchantPerformance>('/merchants/me/performance', token),
    demand: (token: string | null) => request<DemandInsight>('/merchants/me/demand', token),
    // CF-0119: query from src/lib/reviews.ts myReviewsQuery.
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
  },
  cart: {
    get: (token: string | null) =>
      request<ApiCart>('/carts/me', token),
    // The server builds each line from the listing; send only these two.
    replace: (token: string | null, items: { produce_id: number; quantity: number }[]) =>
      request<ApiCart>('/carts/me', token, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      }),
  },
  orders: {
    current: (token: string | null) =>
      request<ApiCurrentOrder[]>('/orders/me/current', token),
    history: (token: string | null) =>
      request<ApiHistoryOrder[]>('/orders/me/history', token),
    // CF-0102: one page, newest first, filtered by status group and/or search.
    historyPage: (token: string | null, query: HistoryQuery) =>
      request<ApiPage<ApiHistoryOrder>>(`/orders/me/history/page?${historyQueryString(query)}`, token),
    detail: (token: string | null, orderId: number) =>
      request<ApiOrderDetail>(`/orders/me/${orderId}`, token),
    // CF-0135: 404 when not the caller's order, 409 when it has no payment yet.
    receipt: (token: string | null, orderId: number) =>
      request<ApiReceipt>(`/orders/me/${orderId}/receipt`, token),
    // Both return the order as /orders/me/current does; the screen re-reads the detail after.
    cancel: (token: string | null, orderId: number) =>
      request<ApiCurrentOrder>(`/orders/me/${orderId}/cancel`, token, { method: 'POST' }),
    // CF-0113: the buyer's review of a delivered order.
    createReview: (token: string | null, orderId: number, body: { rating: number; comment: string | null }) =>
      request<ApiOrderReview>(`/orders/me/${orderId}/review`, token, { method: 'POST', body: JSON.stringify(body) }),
    updateReview: (token: string | null, orderId: number, body: { rating: number; comment: string | null }) =>
      request<ApiOrderReview>(`/orders/me/${orderId}/review`, token, { method: 'PATCH', body: JSON.stringify(body) }),
    confirmReceived: (token: string | null, orderId: number) =>
      request<ApiCurrentOrder>(`/orders/me/${orderId}/confirm-received`, token, { method: 'POST' }),
    // CF-0131: what a farm voucher code takes off the server cart now (no hold).
    previewVoucher: (token: string | null, voucherCode: string) =>
      request<VoucherPreview>('/orders/me/voucher-preview', token, {
        method: 'POST',
        body: JSON.stringify({ voucher_code: voucherCode }),
      }),
    place: (token: string | null, payload: PlaceOrderPayload) =>
      request<PlaceOrderResponse>('/orders/me/place', token, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
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
  },
  payments: {
    // CF-0124: give up an unpaid checkout; the server releases the held stock.
    cancel: (token: string | null, orderId: number) =>
      request<null>(`/payments/checkout/${orderId}/cancel`, token, { method: 'POST' }),
    checkout: (token: string | null, orderId: number) =>
      request<CheckoutSessionResponse>(`/payments/checkout/${orderId}`, token, {
        method: 'POST',
      }),
    transactionByOrder: (token: string | null, orderId: number) =>
      request<TransactionStatusResponse>(`/payments/transactions/order/${orderId}`, token),
  },
  tracking: {
    forOrder: (token: string | null, orderId: number) =>
      request<ApiTracking>(`/tracking/${orderId}`, token),
  },
  // Public farm reviews (CF-0112).
  reviews: {
    forMerchant: (merchantId: number, offset: number, limit: number) =>
      request<MerchantReviews>(`/merchants/${merchantId}/reviews?limit=${limit}&offset=${offset}`, null),
  },
  saved: {
    ids: (token: string | null) => request<number[]>('/users/me/saved-produce/ids', token),
    list: (token: string | null) => request<ApiSavedProduce[]>('/users/me/saved-produce', token),
    save: (token: string | null, produceId: number) =>
      request<null>(`/produce/${produceId}/save`, token, { method: 'PUT' }),
    unsave: (token: string | null, produceId: number) =>
      request<null>(`/produce/${produceId}/save`, token, { method: 'DELETE' }),
  },
  search: {
    // CF-0118: one page with filters; query from src/lib/produceSearch.ts searchQuery.
    page: (token: string | null, query: string) =>
      request<ApiPage<ApiProduceSearchResult>>(`/produce/search?${query}`, token),
    produce: (token: string | null, q: string, pageSize = 10) =>
      request<ApiPage<ApiProduceSearchResult>>(
        `/produce/search?q=${encodeURIComponent(q)}&in_stock=true&page_size=${pageSize}`,
        token,
      ),
  },
  // Support chat (CH2): the user's own conversation with the admins.
  support: {
    thread: (token: string | null, afterId = 0) =>
      request<ApiChatThread>(`/support/messages?after_id=${afterId}`, token),
    send: (token: string | null, body: string) =>
      request<ApiChatMessage>('/support/messages', token, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
  },
  chat: {
    thread: (token: string | null, orderId: number, afterId = 0) =>
      request<ApiChatThread>(`/orders/${orderId}/messages?after_id=${afterId}`, token),
    send: (token: string | null, orderId: number, body: string) =>
      request<ApiChatMessage>(`/orders/${orderId}/messages`, token, {
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
  follows: {
    // Favourite farms (U4).
    mine: (token: string | null) => request<number[]>('/users/me/follows', token),
    follow: (token: string | null, merchantId: number) =>
      request<null>(`/merchants/${merchantId}/follow`, token, { method: 'PUT' }),
    unfollow: (token: string | null, merchantId: number) =>
      request<null>(`/merchants/${merchantId}/follow`, token, { method: 'DELETE' }),
  },
  reorder: {
    // "Buy again" (U3); the response's cart lines feed the app's local cart.
    order: (token: string | null, orderId: number) =>
      request<{
        added: { produce_id: number; name: string; quantity: number; price: number; reduced_from: number | null }[];
        unavailable: { name: string; reason: string }[];
        cart: { items: Record<string, unknown>[] };
      }>(`/orders/me/${orderId}/reorder`, token, { method: 'POST' }),
  },
  referencePrices: {
    list: (token: string | null) =>
      request<ApiReferencePrice[]>('/reference-prices', token),
  },
  users: {
    me: (token: string | null) =>
      request<ApiUserProfile>('/users/me', token),
    // CF-0132: body from togglePrefs (src/lib/notificationPrefs.ts), the three known keys only.
    updateNotificationPrefs: (token: string | null, prefs: NotificationPrefs) =>
      request<ApiUserProfile>('/users/me', token, {
        method: 'PATCH',
        body: JSON.stringify({ notifications_preferences: prefs }),
      }),
    // CF-0122: account deletion (texted code, then DELETE with the code).
    deleteCode: (token: string | null, body: { password: string | null }) =>
      request<{ sent_to: string }>('/users/me/delete-code', token, { method: 'POST', body: JSON.stringify(body) }),
    deleteAccount: (token: string | null, code: string) =>
      request<null>('/users/me', token, { method: 'DELETE', body: JSON.stringify({ code }) }),
  },
  // Address book (CF-0110). Bodies: src/lib/addresses.ts checkAddress (backend extra="forbid").
  addresses: {
    list: (token: string | null) => request<ApiUserAddress[]>('/users/me/addresses', token),
    create: (token: string | null, body: AddressPayload & { is_default?: boolean }) =>
      request<ApiUserAddress>('/users/me/addresses', token, { method: 'POST', body: JSON.stringify(body) }),
    update: (token: string | null, id: number, body: Partial<AddressPayload> & { is_default?: true }) =>
      request<ApiUserAddress>(`/users/me/addresses/${id}`, token, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (token: string | null, id: number) =>
      request<null>(`/users/me/addresses/${id}`, token, { method: 'DELETE' }),
  },
};
