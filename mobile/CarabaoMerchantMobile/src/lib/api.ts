// Merchant API client, core only (plan §2.3/§2.4): the HTTP client from the buyer
// app plus the one method the root gate needs (api.users.me). Merchant methods
// arrive with the moved screens; this file is not in sharedCopies.test.ts.
import { getAccessToken } from './authClient';
import { emitSessionExpired, sessionGone } from './sessionEvents';
import { parseErrorBody } from './apiErrors';
import { API_BASE } from './config';

export { API_BASE, WEB_BASE } from './config';

const REQUEST_TIMEOUT_MS = 20000;

export class ApiError extends Error {
  // CF-0123: message per form field from the server (src/lib/apiErrors.ts), {} when none.
  constructor(message: string, public status: number, public fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

// `token` says whether the call is signed in (screens pass the one from useAuth).
// The header always carries a current token: they last 15 minutes, so an older
// one is swapped for a fresh one, and a 401 gets one retry with a new token.
export async function request<T>(
  path: string,
  token: string | null,
  options?: RequestInit,
): Promise<T> {
  if (!token) return send<T>(path, null, options);
  try {
    return await send<T>(path, (await getAccessToken()) ?? token, options);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) throw err;
    const fresh = await getAccessToken({ forceRefresh: true });
    // CF-0120: no new token, or a 401 again with a new one: the session is gone.
    // Tell the auth layer once; it signs out and protected screens go to sign-in.
    if (!fresh) {
      emitSessionExpired();
      throw err;
    }
    try {
      return await send<T>(path, fresh, options);
    } catch (again) {
      if (again instanceof ApiError && sessionGone(again.status, true, true)) emitSessionExpired();
      throw again;
    }
  }
}

async function send<T>(
  path: string,
  token: string | null,
  options?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((options?.headers as Record<string, string>) ?? {}),
      },
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new ApiError(
      aborted
        ? 'The server took too long to respond. Please try again.'
        : `Could not reach the server at ${API_BASE}. Check your connection.`,
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON (usually an HTML page) means API_BASE points at the wrong host.
      throw new ApiError(
        `Unexpected response from ${API_BASE}${path} (${res.status}). Is EXPO_PUBLIC_API_URL the FastAPI backend?`,
        res.status,
      );
    }
  }
  if (!res.ok) {
    const parsed = parseErrorBody(body);
    throw new ApiError(parsed.message ?? `Request failed (${res.status})`, res.status, parsed.fields);
  }
  return body as T;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type ApiUserProfile = {
  id: number;
  // Identity, read live from BetterAuth. email is null for a phone signup
  // that hasn't added one; phone_number is "+639XXXXXXXXX".
  name: string | null;
  email: string | null;
  email_verified: boolean;
  phone_number: string | null;
  phone_verified: boolean;
  created_at: string | null;
  // The gate reads this: null means the account has no farm yet.
  merchant: { id: number; merchant_name: string } | null;
  // Not read in this app; the backend still sends them for a buyer account.
  cart?: { id: number; total_items: number; total_price: number } | null;
  // Saved delivery addresses, default first.
  addresses?: ApiUserAddress[];
  notifications_preferences?: Record<string, unknown> | null;
};

export type ApiUserAddress = {
  id: number;
  label: string | null;
  region: string | null;
  province: string | null;
  city: string | null;
  barangay: string | null;
  address: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  is_default: boolean;
};

export const api = {
  users: {
    me: (token: string | null) =>
      request<ApiUserProfile>('/users/me', token),
  },
};
