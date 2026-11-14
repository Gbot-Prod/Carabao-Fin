import { createAuthClient } from "better-auth/react";
import { jwtClient, twoFactorClient } from "better-auth/client/plugins";

const authClient = createAuthClient({
  plugins: [
    // Access tokens for the FastAPI backend (GET /api/auth/token).
    jwtClient(),
    // E8: a sign-in that needs a second factor continues on the code page.
    twoFactorClient({
      onTwoFactorRedirect: () => {
        window.location.href = "/two-factor";
      },
    }),
  ],
});

// ── Backend access token ─────────────────────────────────────────────
// A short-lived (15 min) JWT from BetterAuth that FastAPI verifies with the
// public keys at /api/auth/jwks. Kept in memory only, never in a cookie or
// storage, and fetched again shortly before it expires.

const REFRESH_EARLY_MS = 60_000;
let cachedToken: { token: string; expiresAt: number } | null = null;
let pendingToken: Promise<string | null> | null = null;

function tokenExpiry(token: string): number {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(payload)) as { exp?: number };
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** The current backend token, or null when signed out. Concurrent callers share one fetch. */
export const getBackendToken = ({ forceRefresh = false } = {}): Promise<string | null> => {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - REFRESH_EARLY_MS > Date.now()) {
    return Promise.resolve(cachedToken.token);
  }
  pendingToken ??= authClient
    .token()
    .then(({ data }) => {
      const token = data?.token ?? null;
      cachedToken = token ? { token, expiresAt: tokenExpiry(token) } : null;
      return token;
    })
    .catch(() => {
      cachedToken = null;
      return null;
    })
    .finally(() => {
      pendingToken = null;
    });
  return pendingToken;
};

/** Forget the cached token, e.g. on sign-in/out or when its claims change. */
export const clearBackendToken = () => {
  cachedToken = null;
};

// The token carries twoFactorEnabled. Re-read the session past BetterAuth's
// 5-minute cookie cache so the next token has the new value (admin access, E8c).
const refreshTokenClaims = async () => {
  await authClient.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  clearBackendToken();
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (!error || typeof error !== "object") {
    return fallback;
  }

  const maybeError = error as {
    message?: string;
    statusText?: string;
  };

  return maybeError.message || maybeError.statusText || fallback;
};

export const signIn = {
  email: async (credentials: { email: string; password: string }) => {
    const { data, error } = await authClient.signIn.email(credentials);

    // BetterAuth's admin plugin reports an account an admin suspended as BANNED_USER.
    if (error?.code === "BANNED_USER") {
      throw new Error("This account has been suspended. Contact Carabao support.");
    }
    if (error || !data) {
      throw new Error(getErrorMessage(error, "Login failed"));
    }

    // Two-step verification (E8b): no session until the code page succeeds;
    // the client plugin is already on its way there.
    if ((data as { twoFactorRedirect?: boolean }).twoFactorRedirect) {
      return { twoFactorRedirect: true as const };
    }

    // A different account may have been signed in before.
    clearBackendToken();
    return data;
  },
};

export const signUp = {
  email: async (userData: {
    email: string;
    password: string;
    name: string;
  }) => {
    const { data, error } = await authClient.signUp.email({
      ...userData,
      callbackURL: "/email-verified",
    });

    if (error || !data) {
      throw new Error(getErrorMessage(error, "Signup failed"));
    }

    // requireEmailVerification means sign-up never opens a session, and an
    // existing email gets a look-alike success (anti-enumeration). Callers
    // either sign in next (email-OTP signups) or wait for the emailed link,
    // which lands on /email-verified.
    return data;
  },
};

export const resendVerificationEmail = async (email: string) => {
  const { data, error } = await authClient.sendVerificationEmail({
    email,
    callbackURL: "/email-verified",
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "EMAIL_ALREADY_VERIFIED") {
      throw new Error("ALREADY_VERIFIED");
    }
    throw new Error(getErrorMessage(error, "Could not resend verification email"));
  }

  return data;
};

export const signOut = async () => {
  clearBackendToken();
  const { data, error } = await authClient.signOut();

  if (error || !data) {
    throw new Error(getErrorMessage(error, "Logout failed"));
  }

  return data;
};

// Forgot password (E6). BetterAuth answers the same whether or not the email
// has an account, so the page can't be used to discover accounts.
export const requestPasswordReset = async (email: string) => {
  const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
  if (error) throw new Error(getErrorMessage(error, "Could not send the reset email"));
};

export const resetPassword = async (newPassword: string, token: string) => {
  const { error } = await authClient.resetPassword({ newPassword, token });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "INVALID_TOKEN") throw new Error("INVALID_TOKEN");
    throw new Error(getErrorMessage(error, "Could not reset the password"));
  }
};

// Two-step verification (E8a). Enabling returns the authenticator URI and
// backup codes; the plugin only turns it on after a first code is verified.
export const getTwoFactorEnabled = async (): Promise<boolean> => {
  const { data } = await authClient.getSession();
  return Boolean((data?.user as { twoFactorEnabled?: boolean | null } | undefined)?.twoFactorEnabled);
};

export const enableTwoFactor = async (password: string) => {
  const { data, error } = await authClient.twoFactor.enable({ password });
  if (error || !data) throw new Error(getErrorMessage(error, "Could not start two-step verification"));
  return data;
};

export const verifyTwoFactorSetup = async (code: string) => {
  const { error } = await authClient.twoFactor.verifyTotp({ code });
  if (error) throw new Error(getErrorMessage(error, "That code didn't match. Try the newest code."));
  // The backend reads the flag from the token (admin access depends on it, E8c).
  await refreshTokenClaims();
};

export const disableTwoFactor = async (password: string) => {
  const { error } = await authClient.twoFactor.disable({ password });
  if (error) throw new Error(getErrorMessage(error, "Could not turn off two-step verification"));
  await refreshTokenClaims();
};

// Second step of a two-step sign-in (E8b): an authenticator or backup code
// finishes the BetterAuth session.
export const completeTwoFactorSignIn = async (
  code: string,
  { backup = false, trustDevice = false }: { backup?: boolean; trustDevice?: boolean } = {},
) => {
  const { error } = backup
    ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
    : await authClient.twoFactor.verifyTotp({ code, trustDevice });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "INVALID_TWO_FACTOR_COOKIE") throw new Error("SIGN_IN_AGAIN");
    throw new Error(getErrorMessage(error, "That code didn't work."));
  }
  clearBackendToken();
};
