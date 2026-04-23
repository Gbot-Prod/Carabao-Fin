import axios from 'axios';

const rawApiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_FASTAPI_URL || 'http://localhost:8000';

const API_BASE_URL = rawApiBaseUrl.startsWith('http')
  ? rawApiBaseUrl
  : `https://${rawApiBaseUrl}`;

function readBackendToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)backend_access_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Create axios instance with auth header
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// Attach the backend JWT as a Bearer token on every request.
// The cookie lives on the Next.js origin so the browser won't send it to the
// FastAPI origin automatically — we read it ourselves and forward it.
apiClient.interceptors.request.use((config) => {
  const token = readBackendToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Avoid hard redirects here; route protection is already handled by middleware
    // and forced navigation on 401 can create reload loops.
    return Promise.reject(error);
  }
);

export type Produce = {
  id: number;
  merchant_id: number;
  name: string | null;
  description: string | null;
  contact_number: string | null;
  operating_hours: string | null;
  delivery_time: number | null;
  delivery_price: number | null;
  rating: number | null;
};

export type Merchant = {
  id: number;
  user_id: number;
  merchant_name: string;
  location: string | null;
  contact_number: string;
  operating_hours: string | null;
  delivery_price: number | null;
  delivery_time: number | null;
  rating: number | null;
  produces: Produce[];
};

export type MerchantCreatePayload = {
  merchant_name: string;
  location?: string | null;
  contact_number: string;
  operating_hours?: string | null;
  delivery_price?: number | null;
  delivery_time?: number | null;
  rating?: number | null;
};

export type MerchantOnboardingPayload = {
  merchant_name: string;
  legal_business_name: string;
  business_type: string;
  tin?: string | null;
  registration_type?: string | null;
  registration_number?: string | null;
  contact_email: string;
  contact_number: string;
  address_line: string;
  city: string;
  province: string;
  region?: string | null;
  postal_code?: string | null;
  price_range_min: number;
  price_range_max: number;
  available_days: string[];
  rsbsa_number?: string | null;
};

export type CartItem = {
  id: string;
  farm: string;
  produce: string;
  unit: string;
  quantity: number;
  price: number;
};

export type Cart = {
  id: number;
  user_id: number;
  items: CartItem[];
  total_items: number;
  total_price: number;
};

export type UserProfile = {
  id: number;
  external_auth_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone_number: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
  created_at: string | null;
  merchant: {
    id: number;
    merchant_name: string;
  } | null;
  cart: {
    id: number;
    total_items: number;
    total_price: number;
  } | null;
};

export type UserProfileUpdatePayload = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string;
  phone_number?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  postal_code?: string | null;
};

export type OrderHistoryItem = {
  id: number;
  order_id: number;
  merchant: string;
  merchant_id?: number | null;
  merchant_page_slug?: string | null;
  total_amount: number;
  order_date: string;
  status: string;
  items: CartItem[];
};

export type MerchantPerformance = {
  merchant_id: number;
  merchant_name: string;
  rating?: number | null;
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

export type CurrentOrderItem = {
  id: number;
  order_id: number;
  merchant: string;
  merchant_id?: number | null;
  merchant_page_slug?: string | null;
  shipped: boolean;
  date_bought: string;
  time_of_arrival: string | null;
  delivery_fee: number;
  image: string | null;
  status: string;
};

export type PlaceOrderPayload = {
  delivery_date?: string | null;
  delivery_time?: string | null;
  payment_method?: string | null;
  notes?: string | null;
  service_fee?: number;
  image?: string | null;
};

export type PlaceOrderResponse = {
  order_id: number;
  order_reference: string;
  status: string;
};

export const fetchMerchants = async (): Promise<Merchant[]> => {
  const response = await apiClient.get<Merchant[]>('/merchants');
  return response.data;
};

export const fetchMerchantById = async (merchantId: number): Promise<Merchant> => {
  const response = await apiClient.get<Merchant>(`/merchants/${merchantId}`);
  return response.data;
};

export const createMyMerchant = async (
  payload: MerchantCreatePayload,
): Promise<Merchant> => {
  const response = await apiClient.post<Merchant>('/merchants/me', payload);
  return response.data;
};

export const submitMyMerchantOnboarding = async (
  payload: MerchantOnboardingPayload,
  rsbsaFile: File,
): Promise<Merchant> => {
  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  formData.append('rsbsa_file', rsbsaFile);

  const response = await apiClient.post<Merchant>('/merchant-onboarding/me', formData);
  return response.data;
};

export const fetchMyCart = async (): Promise<Cart> => {
  const response = await apiClient.get<Cart>('/carts/me');
  return response.data;
};

export const replaceMyCart = async (items: CartItem[]): Promise<Cart> => {
  const response = await apiClient.put<Cart>('/carts/me', { items });
  return response.data;
};

export const fetchMyProfile = async (): Promise<UserProfile> => {
  const response = await apiClient.get<UserProfile>('/users/me');
  return response.data;
};

export const updateMyProfile = async (
  payload: UserProfileUpdatePayload,
): Promise<UserProfile> => {
  const response = await apiClient.patch<UserProfile>('/users/me', payload);
  return response.data;
};

export const fetchOrderHistory = async (): Promise<OrderHistoryItem[]> => {
  const response = await apiClient.get<OrderHistoryItem[]>('/orders/me/history');
  return response.data;
};

export const fetchCurrentOrders = async (): Promise<CurrentOrderItem[]> => {
  const response = await apiClient.get<CurrentOrderItem[]>('/orders/me/current');
  return response.data;
};

export const fetchMyMerchantPerformance = async (): Promise<MerchantPerformance> => {
  const response = await apiClient.get<MerchantPerformance>('/merchants/me/performance');
  return response.data;
};

export const placeOrderFromCart = async (
  payload: PlaceOrderPayload,
): Promise<PlaceOrderResponse> => {
  const response = await apiClient.post<PlaceOrderResponse>('/orders/me/place', payload);
  return response.data;
};

export type TrackingPosition = { lat: number; lng: number };

export type TrackingData = {
  order_id: number;
  origin: TrackingPosition;
  destination: TrackingPosition;
  current_position: TrackingPosition;
  waypoints: TrackingPosition[];
  progress: number;
  eta_minutes: number;
};

export const fetchDummyTracking = async (orderId: number): Promise<TrackingData> => {
  const response = await apiClient.get<TrackingData>(`/tracking/${orderId}`);
  return response.data;
};

export default apiClient;
