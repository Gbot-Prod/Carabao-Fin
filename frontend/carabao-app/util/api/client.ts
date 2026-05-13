import axios, { type AxiosRequestConfig } from 'axios';

const rawApiBaseUrl = (
  process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_FASTAPI_URL || 'http://localhost:8000'
).trim().replace(/^"|"$/g, '');

const API_BASE_URL = rawApiBaseUrl.startsWith('http')
  ? rawApiBaseUrl
  : `https://${rawApiBaseUrl}`;

function readBackendToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)backend_access_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function refreshBackendToken(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth', { method: 'POST', credentials: 'include' });
    return res.ok;
  } catch {
    return false;
  }
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// The cookie lives on the Next.js origin so the browser won't send it to the
// FastAPI origin automatically — we read it ourselves and forward it.
apiClient.interceptors.request.use((config) => {
  const token = readBackendToken();
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
      const refreshed = await refreshBackendToken();
      if (refreshed) {
        const newToken = readBackendToken();
        if (newToken && originalConfig.headers) {
          (originalConfig.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
        }
        return apiClient(originalConfig);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
