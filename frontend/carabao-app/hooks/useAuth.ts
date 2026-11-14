"use client";

import { useEffect, useState } from "react";

type AuthSession = {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role?: string | null;
  };
};

type SessionResponse = {
  session: AuthSession | null;
};

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const response = await fetch("/api/auth/get-session");
        if (!response.ok) return;

        const data: SessionResponse = await response.json();
        setSession(data.session);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch session"));
      } finally {
        setIsLoading(false);
      }
    };

    void init();
  }, []);

  return {
    session,
    user: session?.user,
    isLoading,
    isAuthenticated: !!session,
    // A BetterAuth session is all the backend needs: API calls get a token
    // from it on demand (lib/auth-client.ts getBackendToken).
    isBackendAuthenticated: !!session,
    error,
  };
}
