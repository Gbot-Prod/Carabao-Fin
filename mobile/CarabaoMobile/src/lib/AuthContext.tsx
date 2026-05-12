import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'carabao_token';
const USER_KEY = 'carabao_user';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface MobileAuthResponse {
  ok: boolean;
  user_id: number;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  access_token: string;
  expires_in?: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function buildUser(data: MobileAuthResponse): User {
  return {
    id: String(data.user_id),
    email: data.email,
    firstName: data.first_name ?? '',
    lastName: data.last_name ?? '',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore persisted session on mount
  useEffect(() => {
    const restore = async () => {
      try {
        const [savedToken, savedUserJson] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        if (savedToken && savedUserJson) {
          setToken(savedToken);
          setUser(JSON.parse(savedUserJson) as User);
        }
      } catch {
        // Storage read failed — start unauthenticated
      } finally {
        setIsLoading(false);
      }
    };
    void restore();
  }, []);

  const persist = async (t: string, u: User) => {
    await Promise.all([
      AsyncStorage.setItem(TOKEN_KEY, t),
      AsyncStorage.setItem(USER_KEY, JSON.stringify(u)),
    ]);
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
    await persist(data.access_token, u);
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
    await persist(data.access_token, u);
  };

  const signOut = async () => {
    setToken(null);
    setUser(null);
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
  };

  return (
    <AuthContext.Provider
      value={{ user, token, isAuthenticated: !!user, isLoading, signIn, signUp, signOut }}
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
