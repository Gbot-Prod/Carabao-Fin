import { apiClient } from './client';
import type { UserProfile } from './users';
import type { Merchant } from './merchants';

export type MerchantApplication = {
  id: number;
  user_id: number;
  status: string;
  submitted_at: string | null;
  merchant_name: string;
  legal_business_name: string;
  business_type: string;
  tin: string | null;
  registration_type: string | null;
  registration_number: string | null;
  contact_email: string;
  contact_number: string;
  address_line: string;
  city: string;
  province: string;
  region: string | null;
  postal_code: string | null;
  price_range_min: number;
  price_range_max: number;
  available_days: string[];
  rsbsa_number: string | null;
  rsbsa_document_path: string;
  rsbsa_document_original_name: string | null;
  rsbsa_document_content_type: string | null;
};

export type { UserProfile, Merchant };

export const fetchAdminUsers = async (): Promise<UserProfile[]> => {
  const res = await apiClient.get<UserProfile[]>('/admin/users');
  return res.data;
};

export const fetchAdminMerchantApplications = async (): Promise<MerchantApplication[]> => {
  const res = await apiClient.get<MerchantApplication[]>('/admin/merchant-applications');
  return res.data;
};

export const fetchAdminMerchants = async (): Promise<Merchant[]> => {
  const res = await apiClient.get<Merchant[]>('/merchants');
  return res.data;
};
