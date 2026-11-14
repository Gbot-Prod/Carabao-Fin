import { createAuthClient } from "better-auth/react";
import { jwtClient, phoneNumberClient, twoFactorClient } from "better-auth/client/plugins";
import { normalizePhMobile } from "@/lib/phone";

const authClient = createAuthClient({
  plugins: [
    // Access tokens for the FastAPI backend (GET /api/auth/token).
    jwtClient(),
    // Phone signup, sign-in, verification and SMS password reset.
    phoneNumberClient(),
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

// Re-read the session past BetterAuth's 5-minute cookie cache after an
// identity change (name, phone, 2FA), so the app shows the new value at once.
// The backend reads identity live from BetterAuth's table and needs nothing.
const refreshSession = async () => {
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

const errorCode = (error: unknown) => (error as { code?: string } | null)?.code;

// BetterAuth's admin plugin reports an account an admin suspended as BANNED_USER.
const SUSPENDED_MESSAGE = "This account has been suspended. Contact Carabao support.";

type SignInResult = { twoFactorRedirect: true } | Record<string, unknown>;

const finishSignIn = (data: unknown, error: unknown, fallback: string): SignInResult => {
  if (errorCode(error) === "BANNED_USER") throw new Error(SUSPENDED_MESSAGE);
  if (error || !data) throw new Error(getErrorMessage(error, fallback));
  // Two-step verification (E8b): no session until the code page succeeds;
  // the client plugin is already on its way there.
  if ((data as { twoFactorRedirect?: boolean }).twoFactorRedirect) {
    return { twoFactorRedirect: true as const };
  }
  // A different account may have been signed in before.
  clearBackendToken();
  return data as Record<string, unknown>;
};

/** Normalizes a typed number or throws the message to show. */
const requirePhone = (value: string) => {
  const phone = normalizePhMobile(value);
  if (!phone) throw new Error("Enter a Philippine mobile number, e.g. 0912 345 6789.");
  return phone;
};

type Credentials = { password: string; rememberMe?: boolean };

export const signIn = {
  phone: async ({ phoneNumber, password, rememberMe }: Credentials & { phoneNumber: string }) => {
    const { data, error } = await authClient.signIn.phoneNumber({
      phoneNumber: requirePhone(phoneNumber),
      password,
      rememberMe,
    });
    return finishSignIn(data, error, "Wrong phone number or password.");
  },
  // Accounts that added and verified an email can sign in with it too.
  email: async (credentials: Credentials & { email: string }) => {
    const { data, error } = await authClient.signIn.email(credentials);
    return finishSignIn(data, error, "Wrong email or password.");
  },
  // Google or Facebook: leaves the page and comes back signed in, creating the
  // account on first use. Failures return to /auth?error=<code>.
  social: async (provider: "google" | "facebook") => {
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: "/",
      errorCallbackURL: "/auth",
    });
    if (error) throw new Error(getErrorMessage(error, "We couldn't reach that sign-in service."));
  },
};

/** Messages for the ?error= codes BetterAuth adds when a Google/Facebook sign-in fails. */
export const socialErrorMessage = (code: string) => {
  switch (code) {
    case "account_not_linked":
      return "That email already belongs to a Carabao account. Log in with your number or email instead.";
    case "banned":
      return SUSPENDED_MESSAGE;
    case "access_denied":
      return "Sign-in was cancelled.";
    default:
      return "We couldn't sign you in with that account. Please try again.";
  }
};

/** Normalizes a typed number, or null; for checking the number before the next step. */
export const isValidPhone = (value: string) => normalizePhMobile(value) !== null;

// ── Text codes ────────────────────────────────────────────────────────────
// For signup, and for verifying a number on an existing account (checkout, profile).

export const sendPhoneCode = async (phoneNumber: string) => {
  const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: requirePhone(phoneNumber) });
  if (error) throw new Error(getErrorMessage(error, "We couldn't send the code. Try again shortly."));
};

/**
 * Finishes a phone signup with the texted code (sendPhoneCode first). The code
 * creates the account with the number verified and signs in; then the password
 * and name are set. A number that already has an account is refused by the
 * server (lib/auth.ts phoneVerifyGuard): the code is not a login.
 */
export const signUpWithPhone = async ({
  phoneNumber,
  code,
  name,
  password,
}: { phoneNumber: string; code: string; name: string; password: string }) => {
  clearBackendToken();
  const { error } = await authClient.phoneNumber.verify({
    phoneNumber: requirePhone(phoneNumber),
    code: code.trim(),
  });
  if (errorCode(error) === "BANNED_USER") throw new Error(SUSPENDED_MESSAGE);
  if (error) {
    throw new Error(errorCode(error) === "PHONE_NUMBER_EXIST" ? "That number already has an account. Log in instead." : codeError(error));
  }

  const set = await authClient.$fetch("/phone-number/set-password", {
    method: "POST",
    body: { newPassword: password },
  });
  if (set.error) throw new Error(getErrorMessage(set.error, "We couldn't set your password."));
  // New accounts start with an empty name (getTempName in lib/auth.ts).
  const cleanName = name.trim().replace(/\s+/g, " ");
  if (cleanName) await authClient.updateUser({ name: cleanName });
  await refreshSession();
};

const codeError = (error: unknown) => {
  switch (errorCode(error)) {
    case "INVALID_OTP":
      return "That code didn't match. Check the latest text and try again.";
    case "OTP_EXPIRED":
    case "OTP_NOT_FOUND":
      return "That code has expired. Send a new one.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many wrong codes. Send a new one.";
    case "PHONE_NUMBER_EXIST":
      return "That number belongs to another account.";
    default:
      return getErrorMessage(error, "We couldn't check the code.");
  }
};

// ── Phone and email on an existing account ───────────────────────────────

/** Adds or changes the account's number; the code proves it (checkout needs one). */
export const verifyMyPhone = async (phoneNumber: string, code: string) => {
  const phone = requirePhone(phoneNumber);
  // A number given at signup is already on the account, unverified. BetterAuth
  // refuses updatePhoneNumber for a number that's on any account (this one
  // too), so that case only marks it verified.
  const { data: session } = await authClient.getSession({ query: { disableCookieCache: true } });
  const ownNumber = (session?.user as { phoneNumber?: string | null } | undefined)?.phoneNumber === phone;
  const { error } = await authClient.phoneNumber.verify(
    ownNumber
      ? { phoneNumber: phone, code: code.trim(), disableSession: true }
      : { phoneNumber: phone, code: code.trim(), updatePhoneNumber: true },
  );
  if (error) throw new Error(codeError(error));
  await refreshSession();
};

/** Sends a link to the new address; the email changes once it's opened. */
export const addEmail = async (newEmail: string) => {
  const { error } = await authClient.changeEmail({ newEmail: newEmail.trim(), callbackURL: "/email-verified" });
  if (error) throw new Error(getErrorMessage(error, "We couldn't send the verification email."));
};

export const updateName = async (name: string) => {
  const { error } = await authClient.updateUser({ name: name.trim().replace(/\s+/g, " ") });
  if (error) throw new Error(getErrorMessage(error, "We couldn't save your name."));
  await refreshSession();
};

export const signOut = async () => {
  clearBackendToken();
  const { data, error } = await authClient.signOut();

  if (error || !data) {
    throw new Error(getErrorMessage(error, "Logout failed"));
  }

  return data;
};

// ── Forgot password (E6) ─────────────────────────────────────────────────
// By SMS code for everyone; by emailed link for accounts with a verified email.
// Both answer the same whether or not an account exists.

export const requestPhonePasswordReset = async (phoneNumber: string) => {
  const { error } = await authClient.phoneNumber.requestPasswordReset({ phoneNumber: requirePhone(phoneNumber) });
  if (error) throw new Error(getErrorMessage(error, "We couldn't send the code. Try again shortly."));
};

export const resetPasswordWithPhone = async ({
  phoneNumber,
  code,
  newPassword,
}: {
  phoneNumber: string;
  code: string;
  newPassword: string;
}) => {
  const { error } = await authClient.phoneNumber.resetPassword({
    phoneNumber: requirePhone(phoneNumber),
    otp: code.trim(),
    newPassword,
  });
  if (error) throw new Error(codeError(error));
};

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
  await refreshSession();
};

export const disableTwoFactor = async (password: string) => {
  const { error } = await authClient.twoFactor.disable({ password });
  if (error) throw new Error(getErrorMessage(error, "Could not turn off two-step verification"));
  await refreshSession();
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
