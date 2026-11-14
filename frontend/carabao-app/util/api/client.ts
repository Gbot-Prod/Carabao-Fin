import axios, { type AxiosRequestConfig } from 'axios';
import { getBackendToken } from '@/lib/auth-client';

const rawApiBaseUrl = (
  process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_FASTAPI_URL || 'http://localhost:8000'
).trim().replace(/^"|"$/g, '');

const API_BASE_URL = rawApiBaseUrl.startsWith('http')
  ? rawApiBaseUrl
  : `https://${rawApiBaseUrl}`;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  // FastAPI uses no cookies; the Bearer token below is the only credential.
  withCredentials: false,
});

// FastAPI accepts BetterAuth access tokens as a Bearer header (see
// getBackendToken in lib/auth-client.ts). No cookie: the token stays in memory.
apiClient.interceptors.request.use(async (config) => {
  const token = await getBackendToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, attempt one token refresh then retry. Avoid redirect loops —
// if the refresh itself fails, just reject so callers handle it normally.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalConfig = error.config as AxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && !originalConfig._retry) {
      originalConfig._retry = true;
      const newToken = await getBackendToken({ forceRefresh: true });
      if (newToken) {
        if (originalConfig.headers) {
          (originalConfig.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
        }
        return apiClient(originalConfig);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
