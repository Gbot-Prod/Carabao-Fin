import axios from 'axios';

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

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// The cookie lives on the Next.js origin so the br owser won't send it to the
// FastAPI origin automatically — we read it ourselves and forward it.
apiClient.interceptors.request.use((config) => {
  const token = readBackendToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Avoid hard redirects here; route protection is already handled by middleware
// and forced navigation on 401 can create reload loops.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    return Promise.reject(error);
  }
);

export default apiClient;
