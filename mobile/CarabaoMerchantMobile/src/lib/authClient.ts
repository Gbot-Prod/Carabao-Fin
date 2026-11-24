// Merchant copy of mobile/CarabaoMobile/src/lib/authClient.ts, with this app's own
// scheme and storage prefix. Not in sharedCopies.test.ts: the copies differ on
// purpose. APP_SCHEME must match "scheme" in app.json and the trusted origins in
// frontend/carabao-app/lib/auth.ts.
// Sign-in for the app goes through BetterAuth on the website, same as the web.
// The session lives in SecureStore (expoClient); the FastAPI backend gets a
// short-lived access token (15 min) fetched from the session, kept in memory only.
import { createAuthClient } from 'better-auth/react';
import { jwtClient, phoneNumberClient } from 'better-auth/client/plugins';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';
import { WEB_BASE } from './config';

// Must match "scheme" in app.json and the trusted origin in lib/auth.ts on the web.
const APP_SCHEME = 'carabaomerchant';

export const authClient = createAuthClient({
  baseURL: WEB_BASE,
  plugins: [
    // A different prefix from the buyer app, so both can share a device.
    expoClient({ scheme: APP_SCHEME, storagePrefix: 'carabao-merchant', storage: SecureStore }),
    jwtClient(),
    // Phone signup, sign-in, verification and SMS password reset.
    phoneNumberClient(),
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

// ── Sign-in methods (web lib/auth-client.ts) ──────────────────────────

/**
 * True when the account can sign in with a password; false for a Google/Facebook-only
 * account. S16: the danger zone asks before texting the code that closes the farm, as the
 * web does (better-auth listAccounts, `credential` is the password provider).
 */
export async function hasPassword(): Promise<boolean> {
  const { data, error } = await authClient.listAccounts();
  if (error || !data) throw new Error("We couldn't load your sign-in methods.");
  return data.some((account) => account.providerId === 'credential');
}
