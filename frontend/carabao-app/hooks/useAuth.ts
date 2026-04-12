"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";

export function useAuth() {
  const [session, setSession] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch("/api/auth/get-session");
        if (response.ok) {
          const data = await response.json();
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
    error,
  };
}
