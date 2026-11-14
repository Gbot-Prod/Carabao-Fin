import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, request } from './api';
import { authClient, clearAccessToken, getAccessToken } from './authClient';
import { awayTooLong, idleTimeoutMs } from './idle';
import { normalizePhMobile, PHONE_HINT } from './phone';

// When the app last left the foreground; also survives the app being killed (E5).
const LEFT_AT_KEY = 'carabao_left_at';
// The old app login kept a 7-day token here; cleared on start so none lingers.
const LEGACY_KEYS = ['carabao_token', 'carabao_user', 'carabao_token_expiry'];

interface User {
  id: string;
  /** null for a phone signup that hasn't added an email */
  email: string | null;
  name: string;
  phoneNumber: string | null;
  /** Checkout, merchant applications and order chat need this. */
  phoneVerified: boolean;
  role?: 'user' | 'merchant' | 'admin';
}

interface MeResponse {
  id: number;
  email: string | null;
  name?: string | null;
  phone_number?: string | null;
  phone_verified?: boolean;
  is_admin?: boolean;
}

/** The account uses two-step verification, which the app can't ask for yet (E8d). */
export class TwoFactorRequiredError extends Error {
  constructor() {
    super("This account uses two-step verification, which the app doesn't support yet. Please sign in on the Carabao website.");
    this.name = 'TwoFactorRequiredError';
  }
}

interface AuthContextType {
  user: User | null;
  /** A current backend token while signed in, else null. Pass it to request(). */
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** A mobile number, or an email the account has verified. */
  signIn: (identifier: string, password: string) => Promise<void>;
  /** Texts a 6-digit code (signup, or adding a number while signed in). */
  sendPhoneCode: (phoneNumber: string) => Promise<void>;
  /**
   * Checks the code, which creates the account and signs in, then sets the
   * password and name. A number that already has an account is refused
   * (the code is not a login; sign in with the password).
   */
  signUpWithPhone: (details: {
    phoneNumber: string;
    code: string;
    name: string;
    password: string;
  }) => Promise<void>;
  /** Adds or changes the signed-in account's number; the code proves it. */
  verifyPhone: (phoneNumber: string, code: string) => Promise<void>;
  /** Re-reads the profile after a name, phone or email change. */
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function buildUser(me: MeResponse): User {
  return {
    id: String(me.id),
    email: me.email ?? null,
    name: me.name ?? '',
    phoneNumber: me.phone_number ?? null,
    phoneVerified: !!me.phone_verified,
    role: me.is_admin ? 'admin' : 'user',
  };
}

type BetterAuthError = { code?: string; message?: string; status?: number } | null | undefined;

function signInMessage(error: BetterAuthError): string {
  switch (error?.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PHONE_NUMBER_OR_PASSWORD':
      return 'Wrong number, email or password. Use "Forgot password?" to set a new one.';
    case 'BANNED_USER':
      return 'This account has been suspended. Contact Carabao support.';
    default:
      if (error?.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
      return error?.message || 'Sign-in failed. Please try again.';
  }
}

/** The message for a wrong, expired or used-up texted code. */
export function codeMessage(error: BetterAuthError): string {
  switch (error?.code) {
    case 'INVALID_OTP':
      return "That code didn't match. Check the latest text and try again.";
    case 'OTP_EXPIRED':
    case 'OTP_NOT_FOUND':
      return 'That code has expired. Send a new one.';
    case 'TOO_MANY_ATTEMPTS':
      return 'Too many wrong codes. Send a new one.';
    case 'PHONE_NUMBER_EXIST':
      return 'That number belongs to another account.';
    case 'BANNED_USER':
      return 'This account has been suspended. Contact Carabao support.';
    default:
      if (error?.status === 429) return 'Too many codes requested. Wait a while and try again.';
      return error?.message || "We couldn't check the code.";
  }
}

/** Normalizes a typed number or throws the message to show. */
export function requirePhone(value: string): string {
  const phone = normalizePhMobile(value);
  if (!phone) throw new ApiError(PHONE_HINT, 400);
  return phone;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearLocal = useCallback(() => {
    clearAccessToken();
    setToken(null);
    setUser(null);
    void AsyncStorage.removeItem(LEFT_AT_KEY).catch(() => {});
  }, []);

  const signOut = useCallback(async () => {
    clearLocal();
    await authClient.signOut().catch(() => {});
  }, [clearLocal]);

  // Fetch a token for the current session and the backend profile it belongs to.
  // The first call also creates the backend row for a new account.
  const loadUser = useCallback(async () => {
    const accessToken = await getAccessToken({ forceRefresh: true });
    if (!accessToken) throw new Error('Sign-in failed. Please try again.');
    try {
      const me = await request<MeResponse>('/auth/me', accessToken);
      setToken(accessToken);
      setUser(buildUser(me));
    } catch (err) {
      // e.g. suspended (403): don't leave a half-signed-in session behind.
      await signOut();
      throw err;
    }
  }, [signOut]);

  // Restore the session on launch.
  useEffect(() => {
    const restore = async () => {
      try {
        void AsyncStorage.multiRemove(LEGACY_KEYS).catch(() => {});
        const leftAtRaw = await AsyncStorage.getItem(LEFT_AT_KEY).catch(() => null);
        const leftAt = leftAtRaw ? parseInt(leftAtRaw, 10) : null;
        if (awayTooLong(leftAt, Date.now(), idleTimeoutMs())) {
          await signOut();
          return;
        }
        const { data } = await authClient.getSession();
        if (data?.session) await loadUser();
      } catch {
        // Offline or the session ended: start signed out.
        clearLocal();
      } finally {
        setIsLoading(false);
      }
    };
    void restore();
  }, [clearLocal, loadUser, signOut]);

  // Keep the context token current, so screens that hold it never pass a stale one.
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      void getAccessToken().then((t) => t && setToken(t));
    }, 60_000);
    return () => clearInterval(id);
  }, [user]);

  // E5: leaving the app records the time; coming back after the idle limit
  // signs out, so the next protected screen sends the user to sign in.
  const leftAtRef = useRef<number | null>(null);
  const signedInRef = useRef(false);
  signedInRef.current = !!user;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (!signedInRef.current) return;
      if (next === 'background' || next === 'inactive') {
        if (leftAtRef.current === null) {
          leftAtRef.current = Date.now();
          void AsyncStorage.setItem(LEFT_AT_KEY, String(leftAtRef.current)).catch(() => {});
        }
      } else if (next === 'active') {
        const leftAt = leftAtRef.current;
        leftAtRef.current = null;
        void AsyncStorage.removeItem(LEFT_AT_KEY).catch(() => {});
        if (awayTooLong(leftAt, Date.now(), idleTimeoutMs())) void signOut();
      }
    });
    return () => sub.remove();
  }, [signOut]);

  const signIn = async (identifier: string, password: string) => {
    clearAccessToken();
    const value = identifier.trim();
    const { data, error } = value.includes('@')
      ? await authClient.signIn.email({ email: value, password })
      : await authClient.signIn.phoneNumber({ phoneNumber: requirePhone(value), password });
    if (error) throw new ApiError(signInMessage(error), error.status ?? 400);
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      throw new TwoFactorRequiredError();
    }
    await loadUser();
  };

  const sendPhoneCode = async (phoneNumber: string) => {
    const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: requirePhone(phoneNumber) });
    if (error) {
      throw new ApiError(error.message || "We couldn't send the code. Try again shortly.", error.status ?? 400);
    }
  };

  const signUpWithPhone: AuthContextType['signUpWithPhone'] = async ({ phoneNumber, code, name, password }) => {
    clearAccessToken();
    const { error } = await authClient.phoneNumber.verify({
      phoneNumber: requirePhone(phoneNumber),
      code: code.trim(),
    });
    if (error) {
      const message = error.code === 'PHONE_NUMBER_EXIST' ? 'That number already has an account. Log in instead.' : codeMessage(error);
      throw new ApiError(message, error.status ?? 400);
    }

    const set = await authClient.$fetch('/phone-number/set-password', {
      method: 'POST',
      body: { newPassword: password },
    });
    if (set.error) {
      throw new ApiError(set.error.message || "We couldn't set your password.", set.error.status ?? 400);
    }
    // New accounts start with an empty name (getTempName on the web server).
    const cleanName = name.trim().replace(/\s+/g, ' ');
    if (cleanName) await authClient.updateUser({ name: cleanName });
    await loadUser();
  };

  const refreshUser = useCallback(async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    setUser(buildUser(await request<MeResponse>('/auth/me', accessToken)));
  }, []);

  const verifyPhone = async (phoneNumber: string, code: string) => {
    const phone = requirePhone(phoneNumber);
    // A number already on this account (unverified) only needs marking
    // verified: BetterAuth refuses updatePhoneNumber for a number on any
    // account, this one included.
    const { data: session } = await authClient.getSession({ query: { disableCookieCache: true } });
    const ownNumber = (session?.user as { phoneNumber?: string | null } | undefined)?.phoneNumber === phone;
    const { error } = await authClient.phoneNumber.verify(
      ownNumber
        ? { phoneNumber: phone, code: code.trim(), disableSession: true }
        : { phoneNumber: phone, code: code.trim(), updatePhoneNumber: true },
    );
    if (error) throw new ApiError(codeMessage(error), error.status ?? 400);
    await refreshUser();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        isLoading,
        signIn,
        sendPhoneCode,
        signUpWithPhone,
        verifyPhone,
        refreshUser,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
