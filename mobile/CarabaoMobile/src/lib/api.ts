import type { ApiReferencePrice } from './referencePrices';

import { getAccessToken } from './authClient';
import { API_BASE } from './config';

export { API_BASE, WEB_BASE } from './config';

const REQUEST_TIMEOUT_MS = 20000;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// FastAPI returns `detail` as a string for HTTPException, but as a list of
// {loc, msg} objects for 422 validation errors.
function extractDetail(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === 'object' ? (d as { msg?: unknown }).msg : null))
      .filter((m): m is string => typeof m === 'string');
    if (msgs.length) return msgs.join('\n');
  }
  return null;
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
    if (!fresh) throw err;
    return send<T>(path, fresh, options);
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
    throw new ApiError(extractDetail(body) ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type ApiMerchant = {
  id: number;
  merchant_name: string;
  address: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  contact_number: string;
  operating_hours: string | null;
  delivery_price: number | null;
  delivery_time: number | null;
  rating: number | null;
  produces: ApiProduce[];
  shop_page: {
    id: number;
    title: string;
    slug: string;
    banner_image_url: string | null;
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
  name: string | null;
  email: string;
  phone_number: string | null;
  created_at: string | null;
  merchant: { id: number; merchant_name: string } | null;
  cart: { id: number; total_items: number; total_price: number } | null;
  // Saved delivery addresses, default first.
  addresses: ApiUserAddress[];
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

// Shape stored in the server-side cart (PUT /carts/me). /orders/me/place
// reads this cart, not the request body, and needs produce_id on each item.
export type ServerCartItem = {
  id: string;
  produce_id: number;
  merchant_id?: number | null;
  produce: string;
  farm: string;
  unit: string;
  price: number;
  quantity: number;
};

export type ApiCart = {
  id: number;
  user_id: number;
  items: ServerCartItem[];
  total_items: number;
  total_price: number;
};

export function merchantLocation(m: Pick<ApiMerchant, 'city' | 'province'>): string {
  return [m.city, m.province].filter(Boolean).join(', ');
}

export type PlaceOrderPayload = {
  delivery_address?: string | null;
  delivery_time?: string | null;
  payment_method?: string | null;
  notes?: string | null;
  service_fee?: number;
};

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
};

// GET /produce/search (U2).
export type ApiProduceSearchResult = ApiProduce & {
  merchant_name: string;
  merchant_province: string | null;
  merchant_city: string | null;
};

export type ApiPage<T> = { items: T[]; total: number; page: number; page_size: number };

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
    stockAlerts: (token: string | null) =>
      request<ApiStockAlerts>('/merchants/me/stock-alerts', token),
    updateOrderStatus: (token: string | null, orderId: number, status: MerchantOrderStatus) =>
      request<ApiMerchantOrder>(`/merchants/me/orders/${orderId}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
  },
  cart: {
    get: (token: string | null) =>
      request<ApiCart>('/carts/me', token),
    replace: (token: string | null, items: ServerCartItem[]) =>
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
  },
  payments: {
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
  search: {
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
    list: (token: string | null) =>
      request<{ items: ApiNotification[]; unread: number }>('/users/me/notifications', token),
    markRead: (token: string | null, id: number) =>
      request<null>(`/users/me/notifications/${id}/read`, token, { method: 'POST' }),
    markAllRead: (token: string | null) =>
      request<null>('/users/me/notifications/read-all', token, { method: 'POST' }),
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
  },
};
