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
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone_number: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
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

export const deleteMyAccount = async (): Promise<void> => {
  await apiClient.delete('/users/me');
};

export const uploadProfilePicture = async (file: File): Promise<UserProfile> => {
  const formData = new FormData();
  formData.append('avatar', file);
  const response = await apiClient.post<UserProfile>('/users/me/avatar', formData);
  return response.data;
};
