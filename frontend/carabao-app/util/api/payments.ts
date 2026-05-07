import { apiClient } from './client';

export type CheckoutSessionResponse = {
  transaction_id: number;
  order_id: number;
  checkout_url: string;
  paymongo_session_id: string;
  amount: number;
  status: string;
};

export type TransactionStatusResponse = {
  id: number;
  order_id: number;
  status: string;
  amount: number;
  platform_fee: number;
  merchant_amount: number;
  paid_at: string | null;
};

export type SavedCard = {
  id: string;
  last4: string;
  brand: string;
  exp_month: number;
  exp_year: number;
};

export type CardTokenizePayload = {
  card_number: string;
  exp_month: number;
  exp_year: number;
  cvc: string;
  name: string;
  email: string;
};

export const createPaymentCheckout = async (orderId: number): Promise<CheckoutSessionResponse> => {
  const response = await apiClient.post<CheckoutSessionResponse>(`/payments/checkout/${orderId}`);
  return response.data;
};

export const fetchTransactionByOrder = async (orderId: number): Promise<TransactionStatusResponse> => {
  const response = await apiClient.get<TransactionStatusResponse>(`/payments/transactions/order/${orderId}`);
  return response.data;
};

export const fetchPaymentMethods = async (): Promise<SavedCard[]> => {
  const response = await apiClient.get<SavedCard[]>('/users/me/payment-methods');
  return response.data;
};

export const attachPaymentMethod = async (paymentMethodId: string): Promise<SavedCard> => {
  const response = await apiClient.post<SavedCard>('/users/me/payment-methods', {
    payment_method_id: paymentMethodId,
  });
  return response.data;
};

export const detachPaymentMethod = async (paymentMethodId: string): Promise<void> => {
  await apiClient.delete(`/users/me/payment-methods/${paymentMethodId}`);
};

// Tokenizes card details directly with PayMongo — card data never touches our server.
export const tokenizeCard = async (payload: CardTokenizePayload): Promise<string> => {
  const publicKey = process.env.NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY;
  if (!publicKey) throw new Error('PayMongo public key is not configured');

  const auth = btoa(`${publicKey}:`);
  const res = await fetch('https://api.paymongo.com/v1/payment_methods', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        attributes: {
          type: 'card',
          details: {
            card_number: payload.card_number.replace(/\s/g, ''),
            exp_month: payload.exp_month,
            exp_year: payload.exp_year,
            cvc: payload.cvc,
          },
          billing: { name: payload.name, email: payload.email },
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { errors?: { detail: string }[] };
    throw new Error(err.errors?.[0]?.detail ?? 'Card tokenization failed');
  }

  const data = await res.json() as { data: { id: string } };
  return data.data.id;
};
