import { apiClient } from './client';
import type { TransactionStatus } from './statuses';

export type CheckoutSessionResponse = {
  transaction_id: number;
  order_id: number;
  checkout_url: string;
  paymongo_session_id: string;
  amount: number;
  status: TransactionStatus;
};

export type TransactionStatusResponse = {
  id: number;
  order_id: number;
  status: TransactionStatus;
  amount: number;
  platform_fee: number;
  merchant_amount: number;
  paid_at: string | null;
};

export const createPaymentCheckout = async (orderId: number): Promise<CheckoutSessionResponse> => {
  const response = await apiClient.post<CheckoutSessionResponse>(`/payments/checkout/${orderId}`);
  return response.data;
};

export const cancelPaymentCheckout = async (orderId: number): Promise<void> => {
  await apiClient.post(`/payments/checkout/${orderId}/cancel`);
};

export const fetchTransactionByOrder = async (orderId: number): Promise<TransactionStatusResponse> => {
  const response = await apiClient.get<TransactionStatusResponse>(`/payments/transactions/order/${orderId}`);
  return response.data;
};
