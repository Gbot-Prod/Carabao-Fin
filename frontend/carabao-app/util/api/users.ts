import { apiClient } from './client';
import type { OrderStatus } from './statuses';

export type NotificationPrefs = {
  order_updates: boolean;
  promotions: boolean;
  email_alerts: boolean;
};

export type UserProfile = {
  id: number;
  external_auth_id: string | null;
  is_admin: boolean;
  // Two-step verification (admins only, E8).
  two_factor_enabled?: boolean;
  // Admin users list only: an invited admin who has not set a password yet.
  admin_invite_pending?: boolean;
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
  // Who receives deliveries here, and a PH mobile number (+639XXXXXXXXX) the rider can call.
  recipient_name?: string | null;
  recipient_phone?: string | null;
  region: string | null;
  province: string | null;
  city: string | null;
  barangay: string | null;
  address: string | null;
  postal_code: string | null;
  // Map pin for the address (U1).
  lat: number | null;
  lng: number | null;
  /** The person placed or moved the pin themselves; false = only where the address geocoded to. */
  pin_confirmed?: boolean;
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

/**
 * Text the code that confirms deleting the account; returns the last 4 digits it
 * went to. The backend checks the password first when the account has one.
 */
export const sendAccountDeleteCode = async (password?: string): Promise<string> => {
  const response = await apiClient.post<{ sent_to: string }>('/users/me/delete-code', { password: password ?? null });
  return response.data.sent_to;
};

/** Delete the account, confirmed with the code from sendAccountDeleteCode. */
export const deleteMyAccount = async (code: string): Promise<void> => {
  await apiClient.delete('/users/me', { data: { code } });
};

/** CF-0069: download the caller's own data as a JSON file (5 per hour). */
export const downloadMyData = async (): Promise<void> => {
  const res = await apiClient.get<Blob>('/users/me/export', { responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'carabao-my-data.json';
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const uploadProfilePicture = async (file: File): Promise<UserProfile> => {
  const formData = new FormData();
  formData.append('avatar', file);
  const response = await apiClient.post<UserProfile>('/users/me/avatar', formData);
  return response.data;
};

/** One order chat in the buyer's chat list (GET /users/me/chats). */
export type BuyerChatSummary = {
  order_id: number;
  order_ref: string;
  order_status: OrderStatus;
  merchant_id: number | null;
  farm_name: string | null;
  /** The farm's shop logo, or null when it has none. */
  farm_logo_url: string | null;
  closed: boolean;
  /** null when the order has no messages yet: the buyer can start the chat. */
  last_body: string | null;
  last_sender_role: string | null;
  last_mine: boolean;
  last_at: string | null;
  ordered_at: string | null;
  unread: number;
};

export const fetchMyChats = async (): Promise<BuyerChatSummary[]> => {
  const response = await apiClient.get<BuyerChatSummary[]>('/users/me/chats');
  return response.data;
};

/**
 * A question a buyer sent a farm before (or without) buying. Listed only once
 * it has a message (GET /users/me/inquiries, GET /merchants/me/inquiries).
 */
export type InquirySummary = {
  conversation_id: number;
  merchant_id: number;
  farm_name: string | null;
  farm_logo_url: string | null;
  buyer_name: string | null;
  /** The farm was removed or suspended: readable, no new messages. */
  closed: boolean;
  last_body: string;
  last_sender_role: string;
  last_mine: boolean;
  last_at: string;
  unread: number;
};

export const fetchMyInquiries = async (): Promise<InquirySummary[]> => {
  const response = await apiClient.get<InquirySummary[]>('/users/me/inquiries');
  return response.data;
};

/** The buyer's side of an inquiry thread with a farm: GET to read, POST to ask. */
export const farmInquiryEndpoint = (merchantId: number) => `/merchants/${merchantId}/inquiry/messages`;
