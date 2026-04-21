import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Create axios instance with auth header
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// Add interceptor to handle 401 responses
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid - redirect to login
      window.location.href = '/auth';
    }
    return Promise.reject(error);
  }
);

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
  created_at: string | null;
};

export const fetchMerchants = async (): Promise<Merchant[]> => {
  const response = await apiClient.get<Merchant[]>('/merchants');
  return response.data;
};

export const createMyMerchant = async (
  payload: MerchantCreatePayload,
): Promise<Merchant> => {
  const response = await apiClient.post<Merchant>('/merchants/me', payload);
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

export default apiClient;
