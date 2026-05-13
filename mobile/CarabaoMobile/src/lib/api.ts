const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

async function request<T>(
  path: string,
  token: string | null,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options?.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type ApiMerchant = {
  id: number;
  merchant_name: string;
  location: string | null;
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
  stock_quantity: number;
  image_url: string | null;
};

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
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone_number: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
  created_at: string | null;
  merchant: { id: number; merchant_name: string } | null;
  cart: { id: number; total_items: number; total_price: number } | null;
};

export type PlaceOrderPayload = {
  delivery_address?: string | null;
  delivery_time?: string | null;
  payment_method?: string | null;
  notes?: string | null;
  service_fee?: number;
};

export type PlaceOrderResponse = {
  order_id: number;
  order_reference: string;
  status: string;
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
    apply: (token: string, payload: { merchant_name: string; location: string; contact_number: string }) =>
      request<ApiMerchant>('/merchants/me', token, { method: 'POST', body: JSON.stringify(payload) }),
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
  users: {
    me: (token: string | null) =>
      request<ApiUserProfile>('/users/me', token),
  },
};
