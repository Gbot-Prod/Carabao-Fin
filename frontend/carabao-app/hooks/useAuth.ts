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

async function triggerBackendSync(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth", { method: "POST", credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      console.error("[auth] Backend sync failed:", body.error ?? res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[auth] Backend sync request threw:", err);
    return false;
  }
}

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
        const sess = data.session;

        if (sess && !sess.backendAuthenticated) {
          // Better Auth session exists but the backend token is missing or expired.
          // Trigger a sync now so subsequent API calls will have a valid token.
          const ok = await triggerBackendSync();
          if (ok) {
            // Re-fetch so backendAuthenticated reflects the new cookie.
            const refreshed = await fetch("/api/auth/get-session");
            if (refreshed.ok) {
              const refreshedData: SessionResponse = await refreshed.json();
              setSession(refreshedData.session);
              return;
            }
          }
        }

        setSession(sess);
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
    isBackendAuthenticated: !!session?.backendAuthenticated,
    error,
  };
}
