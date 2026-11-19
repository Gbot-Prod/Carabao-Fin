import { apiClient } from './client';

// A farm's own voucher codes (CF-0061). The API checks every rule again and
// works out discounts at checkout; nothing here is trusted by the server.

export type VoucherKind = 'percent' | 'fixed';

export type Voucher = {
  id: number;
  code: string;
  kind: VoucherKind;
  value: number;
  min_subtotal: number;
  max_discount: number | null;
  usage_limit: number | null;
  per_user_limit: number;
  starts_at: string | null;
  expires_at: string | null;
  active: boolean;
  created_at: string | null;
  /** Uses on orders that were not cancelled. */
  uses: number;
};

export type VoucherInput = {
  code: string;
  kind: VoucherKind;
  value: number;
  min_subtotal: number;
  max_discount: number | null;
  usage_limit: number | null;
  per_user_limit: number;
  starts_at: string | null;
  expires_at: string | null;
  active: boolean;
};

export type VoucherChanges = Partial<Omit<VoucherInput, 'code'>>;

export const fetchMyVouchers = async (): Promise<Voucher[]> => {
  const response = await apiClient.get<Voucher[]>('/merchants/me/vouchers');
  return response.data;
};

export const createMyVoucher = async (input: VoucherInput): Promise<Voucher> => {
  const response = await apiClient.post<Voucher>('/merchants/me/vouchers', input);
  return response.data;
};

export const updateMyVoucher = async (id: number, changes: VoucherChanges): Promise<Voucher> => {
  const response = await apiClient.patch<Voucher>(`/merchants/me/vouchers/${id}`, changes);
  return response.data;
};

/** 409 when an order used it: turn it off instead. */
export const deleteMyVoucher = async (id: number): Promise<void> => {
  await apiClient.delete(`/merchants/me/vouchers/${id}`);
};
