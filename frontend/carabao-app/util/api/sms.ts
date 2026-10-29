import { apiClient } from './client';

export const sendOtp = async (number: string): Promise<void> => {
  await apiClient.post('/sms/otp/send', { number });
};

/** Returns a short-lived token proving the number was verified; pass it to merchant onboarding. */
export const verifyOtp = async (number: string, otp: string): Promise<string> => {
  const response = await apiClient.post<{ ok: boolean; verification_token: string }>(
    '/sms/otp/verify',
    { number, otp },
  );
  return response.data.verification_token;
};
