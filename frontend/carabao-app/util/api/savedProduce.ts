import { apiClient } from './client';
import type { ProduceSearchResult } from './produceSearch';

// Saved produce (wishlist, CF-0038). Hidden, expired and suspended-farm
// listings are left out of the list but stay saved on the server.

export type SavedProduce = ProduceSearchResult & { saved_at: string };

/** Saved produce ids, most recent first (for the heart icons). */
export const fetchSavedProduceIds = async (): Promise<number[]> => {
  const response = await apiClient.get<number[]>('/users/me/saved-produce/ids');
  return response.data;
};

export const fetchSavedProduce = async (): Promise<SavedProduce[]> => {
  const response = await apiClient.get<SavedProduce[]>('/users/me/saved-produce');
  return response.data;
};

export const saveProduce = async (produceId: number): Promise<void> => {
  await apiClient.put(`/produce/${produceId}/save`);
};

export const unsaveProduce = async (produceId: number): Promise<void> => {
  await apiClient.delete(`/produce/${produceId}/save`);
};
