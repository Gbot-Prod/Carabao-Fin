"use client";

import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { merchantLoginUrl } from "./lib/signIn";

/**
 * For merchant pages outside the shell (onboarding): a signed-out user goes
 * to the merchant login, then comes back. The shell does the same itself.
 */
export default function SignInRequired({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const signedOut = !isLoading && !isAuthenticated;

  useEffect(() => {
    if (!signedOut) return;
    const { pathname, search } = window.location;
    window.location.replace(merchantLoginUrl(pathname + search));
  }, [signedOut]);

  if (isLoading || signedOut) return null;
  return <>{children}</>;
}
