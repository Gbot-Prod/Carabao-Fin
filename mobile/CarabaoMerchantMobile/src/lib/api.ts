// Merchant API client (plan §2.3/§2.4, sections S3, S7 and S11): the HTTP client from the
// buyer app, the methods the merchant screens call, and the one the root gate needs
// (api.users.me). Buyer-only groups are left out (decision D3), except `support`: the
// order-chat screen keeps the buyer's `support=1` branch (S11) and the endpoint is shared.
// This file is not in sharedCopies.test.ts.
import type { MyMerchantReviews, MyReview } from './myReviews';
import type { ChatSummary } from './chatInbox';
import type { DemandInsight, MerchantPerformance } from './dashboard';

import { getAccessToken } from './authClient';
import { emitSessionExpired, sessionGone } from './sessionEvents';
import { parseErrorBody } from './apiErrors';
import { contentTypeFor } from './uploads';
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
  // S2: JSON only for a string body. A FormData body goes without a Content-Type, so
  // fetch writes multipart/form-data with the boundary it generated.
  const contentType = contentTypeFor(options?.body);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
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
}>;

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
  // Set once the order is on a route (ready-to-ship orders have none yet).
  shipment_id: number | null;
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
    // CF-0125: dashboard numbers and province demand.
    performance: (token: string | null) => request<MerchantPerformance>('/merchants/me/performance', token),
    demand: (token: string | null) => request<DemandInsight>('/merchants/me/demand', token),
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
  // S11: the order-chat screen keeps the buyer's support branch (`support=1`); the endpoint
  // is the same for both apps (backend api/routes/support_chat.py).
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
  users: {
    me: (token: string | null) =>
      request<ApiUserProfile>('/users/me', token),
  },
};
