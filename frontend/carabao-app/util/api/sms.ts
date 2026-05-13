import { apiClient } from './client';

export const sendOtp = async (number: string): Promise<void> => {
  await apiClient.post('/sms/otp/send', { number });
};

export const verifyOtp = async (number: string, otp: string): Promise<void> => {
  await apiClient.post('/sms/otp/verify', { number, otp });
};
