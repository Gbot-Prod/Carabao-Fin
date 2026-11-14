import { apiClient } from './client';

export type NotificationPrefs = {
  order_updates: boolean;
  promotions: boolean;
  email_alerts: boolean;
};

export type UserProfile = {
  id: number;
  external_auth_id: string | null;
  is_admin: boolean;
  // An admin suspended the account (A3).
  is_suspended?: boolean;
  suspension_reason?: string | null;
  // Identity, read live from BetterAuth. email is null for a phone signup
  // that hasn't added one; phone_number is "+639XXXXXXXXX".
  name: string | null;
  email: string | null;
  email_verified: boolean;
  phone_number: string | null;
  // Checkout, merchant applications and order chat need this.
  phone_verified: boolean;
  created_at: string | null;
  profile_picture_url: string | null;
  notifications_preferences: Partial<NotificationPrefs> | null;
  merchant: {
    id: number;
    merchant_name: string;
  } | null;
  cart: {
    id: number;
    total_items: number;
    total_price: number;
  } | null;
  // Saved delivery addresses, default first.
  addresses: UserAddress[];
};

export type UserAddressFields = {
  label: string | null;
  region: string | null;
  province: string | null;
  city: string | null;
  barangay: string | null;
  address: string | null;
  postal_code: string | null;
  // Map pin for the address (U1).
  lat: number | null;
  lng: number | null;
};

export type UserAddress = UserAddressFields & {
  id: number;
  is_default: boolean;
  created_at: string | null;
  updated_at: string | null;
};

// Setting is_default: true makes it the default; false does nothing.
export type UserAddressPayload = Partial<UserAddressFields> & { is_default?: boolean };

// Name, email and phone change through BetterAuth (lib/auth-client.ts).
export type UserProfileUpdatePayload = {
  notifications_preferences?: Partial<NotificationPrefs> | null;
};

export const fetchMyProfile = async (): Promise<UserProfile> => {
  const response = await apiClient.get<UserProfile>('/users/me');
  return response.data;
};

export const updateMyProfile = async (payload: UserProfileUpdatePayload): Promise<UserProfile> => {
  const response = await apiClient.patch<UserProfile>('/users/me', payload);
  return response.data;
};

export const fetchMyAddresses = async (): Promise<UserAddress[]> => {
  const response = await apiClient.get<UserAddress[]>('/users/me/addresses');
  return response.data;
};

export const createMyAddress = async (payload: UserAddressPayload): Promise<UserAddress> => {
  const response = await apiClient.post<UserAddress>('/users/me/addresses', payload);
  return response.data;
};

export const updateMyAddress = async (id: number, payload: UserAddressPayload): Promise<UserAddress> => {
  const response = await apiClient.patch<UserAddress>(`/users/me/addresses/${id}`, payload);
  return response.data;
};

export const deleteMyAddress = async (id: number): Promise<void> => {
  await apiClient.delete(`/users/me/addresses/${id}`);
};

/** The default saved address, else the first, else null. */
export const defaultAddress = (addresses: UserAddress[] | null | undefined): UserAddress | null =>
  addresses?.find((a) => a.is_default) ?? addresses?.[0] ?? null;

export const deleteMyAccount = async (): Promise<void> => {
  await apiClient.delete('/users/me');
};

export const uploadProfilePicture = async (file: File): Promise<UserProfile> => {
  const formData = new FormData();
  formData.append('avatar', file);
  const response = await apiClient.post<UserProfile>('/users/me/avatar', formData);
  return response.data;
};
