"use client";

import { useEffect, useState } from "react";

type AuthSession = {
  token: string;
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
  backendAuthenticated?: boolean;
};

type SessionResponse = {
  session: AuthSession | null;
};

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch("/api/auth/get-session");
        if (response.ok) {
          const data: SessionResponse = await response.json();
          setSession(data.session);
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch session"));
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();
  }, []);

  return {
    session,
    user: session?.user,
    isLoading,
    isAuthenticated: !!session,
    isBackendAuthenticated: !!session?.backendAuthenticated,
    error,
  };
}
