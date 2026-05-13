import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'carabao_token';
const USER_KEY = 'carabao_user';
const TOKEN_EXPIRY_KEY = 'carabao_token_expiry';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role?: 'user' | 'merchant' | 'admin';
}

interface MobileAuthResponse {
  ok: boolean;
  user_id: number;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string;
  access_token: string;
  expires_in?: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  tokenExpiry: number | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  signOut: () => Promise<void>;
  validateToken: () => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function buildUser(data: MobileAuthResponse): User {
  return {
    id: String(data.user_id),
    email: data.email,
    firstName: data.first_name ?? '',
    lastName: data.last_name ?? '',
    role: (data.role as 'user' | 'merchant' | 'admin') ?? 'user',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenExpiry, setTokenExpiry] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore persisted session on mount
  useEffect(() => {
    const restore = async () => {
      try {
        const [savedToken, savedUserJson, savedExpiry] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
          AsyncStorage.getItem(TOKEN_EXPIRY_KEY),
        ]);
        if (savedToken && savedUserJson) {
          const expiry = savedExpiry ? parseInt(savedExpiry, 10) : null;
          // Check if token is still valid (not expired)
          if (expiry && expiry > Date.now()) {
            setToken(savedToken);
            setUser(JSON.parse(savedUserJson) as User);
            setTokenExpiry(expiry);
          } else {
            // Token expired, clear everything
            await clearAuth();
          }
        }
      } catch {
        // Storage read failed — start unauthenticated
      } finally {
        setIsLoading(false);
      }
    };
    void restore();
  }, []);

  const clearAuth = async () => {
    setToken(null);
    setUser(null);
    setTokenExpiry(null);
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
      AsyncStorage.removeItem(TOKEN_EXPIRY_KEY),
    ]);
  };

  const persist = async (t: string, u: User, expiresIn: number) => {
    const expiry = Date.now() + expiresIn * 1000;
    setTokenExpiry(expiry);
    await Promise.all([
      AsyncStorage.setItem(TOKEN_KEY, t),
      AsyncStorage.setItem(USER_KEY, JSON.stringify(u)),
      AsyncStorage.setItem(TOKEN_EXPIRY_KEY, String(expiry)),
    ]);
  };

  const validateToken = (): boolean => {
    if (!token || !tokenExpiry) {
      return false;
    }
    return tokenExpiry > Date.now();
  };

  const signIn = async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/mobile/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { detail?: string };
      throw new Error(err.detail ?? 'Sign in failed');
    }
    const data = await res.json() as MobileAuthResponse;
    const u = buildUser(data);
    setToken(data.access_token);
    setUser(u);
    const expiresIn = data.expires_in ?? 3600;
    await persist(data.access_token, u, expiresIn);
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string) => {
    const res = await fetch(`${API_BASE}/auth/mobile/sign-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, first_name: firstName, last_name: lastName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { detail?: string };
      throw new Error(err.detail ?? 'Sign up failed');
    }
    const data = await res.json() as MobileAuthResponse;
    const u = buildUser(data);
    setToken(data.access_token);
    setUser(u);
    const expiresIn = data.expires_in ?? 3600;
    await persist(data.access_token, u, expiresIn);
  };

  const signOut = async () => {
    await clearAuth();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        tokenExpiry,
        isAuthenticated: !!user && validateToken(),
        isLoading,
        signIn,
        signUp,
        signOut,
        validateToken,
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
