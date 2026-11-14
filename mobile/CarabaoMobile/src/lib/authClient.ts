// Sign-in for the app goes through BetterAuth on the website, same as the web.
// The session lives in SecureStore (expoClient); the FastAPI backend gets a
// short-lived access token (15 min) fetched from the session, kept in memory only.
import { createAuthClient } from 'better-auth/react';
import { jwtClient } from 'better-auth/client/plugins';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';
import { WEB_BASE } from './config';

// Must match "scheme" in app.json and the trusted origin in lib/auth.ts on the web.
const APP_SCHEME = 'carabaomobile';

export const authClient = createAuthClient({
  baseURL: WEB_BASE,
  plugins: [
    expoClient({ scheme: APP_SCHEME, storagePrefix: 'carabao', storage: SecureStore }),
    jwtClient(),
  ],
});

// ── Backend access token ─────────────────────────────────────────────

const REFRESH_EARLY_MS = 60_000;
let cached: { token: string; expiresAt: number } | null = null;
let pending: Promise<string | null> | null = null;

function expiryOf(token: string): number {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    const { exp } = JSON.parse(atob(padded)) as { exp?: number };
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** A valid backend token, or null when signed out. Concurrent callers share one fetch. */
export function getAccessToken({ forceRefresh = false } = {}): Promise<string | null> {
  if (!forceRefresh && cached && cached.expiresAt - REFRESH_EARLY_MS > Date.now()) {
    return Promise.resolve(cached.token);
  }
  pending ??= authClient
    .token()
    .then(({ data }) => {
      const token = data?.token ?? null;
      cached = token ? { token, expiresAt: expiryOf(token) } : null;
      return token;
    })
    .catch(() => {
      cached = null;
      return null;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function clearAccessToken() {
  cached = null;
}
