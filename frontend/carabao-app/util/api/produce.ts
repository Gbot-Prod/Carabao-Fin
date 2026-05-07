import { apiClient } from './client';

export type Produce = {
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

export type ProduceCreatePayload = {
  name: string;
  description?: string | null;
  category?: string | null;
  price: number;
  unit?: string;
  stock_quantity?: number;
  image_url?: string | null;
};

export type ProduceUpdatePayload = {
  name?: string | null;
  description?: string | null;
  category?: string | null;
  price?: number | null;
  unit?: string | null;
  stock_quantity?: number | null;
  image_url?: string | null;
};

export const fetchMerchantProduce = async (merchantId: number): Promise<Produce[]> => {
  const response = await apiClient.get<Produce[]>(`/merchants/${merchantId}/produce`);
  return response.data;
};

export const createProduce = async (payload: ProduceCreatePayload): Promise<Produce> => {
  const response = await apiClient.post<Produce>('/produce/', payload);
  return response.data;
};

export const updateProduce = async (produceId: number, payload: ProduceUpdatePayload): Promise<Produce> => {
  const response = await apiClient.patch<Produce>(`/produce/${produceId}`, payload);
  return response.data;
};

export const deleteProduce = async (produceId: number): Promise<void> => {
  await apiClient.delete(`/produce/${produceId}`);
};

export const uploadProduceImage = async (produceId: number, file: File): Promise<Produce> => {
  const formData = new FormData();
  formData.append('image', file);
  const response = await apiClient.post<Produce>(`/produce/${produceId}/image`, formData);
  return response.data;
};
