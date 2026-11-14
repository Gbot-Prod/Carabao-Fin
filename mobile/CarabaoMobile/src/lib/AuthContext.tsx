import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, request } from './api';
import { authClient, clearAccessToken, getAccessToken } from './authClient';
import { awayTooLong, idleTimeoutMs } from './idle';

// When the app last left the foreground; also survives the app being killed (E5).
const LEFT_AT_KEY = 'carabao_left_at';
// The old app login kept a 7-day token here; cleared on start so none lingers.
const LEGACY_KEYS = ['carabao_token', 'carabao_user', 'carabao_token_expiry'];

// Sent with sign-up so BetterAuth knows the email was verified with a code.
// Must match SIGNUP_VERIFICATION_HEADER in the web's lib/auth.ts.
const SIGNUP_VERIFICATION_HEADER = 'x-signup-verification';

interface User {
  id: string;
  email: string;
  name: string;
  role?: 'user' | 'merchant' | 'admin';
}

interface MeResponse {
  id: number;
  email: string;
  name?: string | null;
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
  signIn: (email: string, password: string) => Promise<void>;
  /** `verificationToken` comes from /auth/signup-verification/verify for this email. */
  signUp: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    verificationToken: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function buildUser(me: MeResponse): User {
  return {
    id: String(me.id),
    email: me.email,
    name: me.name ?? '',
    role: me.is_admin ? 'admin' : 'user',
  };
}

type BetterAuthError = { code?: string; message?: string; status?: number } | null | undefined;

function signInMessage(error: BetterAuthError): string {
  switch (error?.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Invalid email or password. Made your account in the app before? Use "Forgot password?" to set a new one.';
    case 'EMAIL_NOT_VERIFIED':
      return "Verify your email first: we've sent you a link. Open it, then sign in here.";
    case 'BANNED_USER':
      return 'This account has been suspended. Contact Carabao support.';
    default:
      if (error?.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
      return error?.message || 'Sign-in failed. Please try again.';
  }
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

  const signIn = async (email: string, password: string) => {
    clearAccessToken();
    const { data, error } = await authClient.signIn.email({ email: email.trim(), password });
    if (error) throw new ApiError(signInMessage(error), error.status ?? 400);
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      throw new TwoFactorRequiredError();
    }
    await loadUser();
  };

  const signUp = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    verificationToken: string,
  ) => {
    const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || email.trim().split('@')[0];
    const { error } = await authClient.signUp.email(
      { email: email.trim(), password, name },
      { headers: { [SIGNUP_VERIFICATION_HEADER]: verificationToken } },
    );
    if (error) throw new ApiError(error.message || 'Sign-up failed. Please try again.', error.status ?? 400);
    // The verified-email signup opens no session by itself (requireEmailVerification);
    // sign in with the same details.
    await signIn(email, password);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        isLoading,
        signIn,
        signUp,
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
