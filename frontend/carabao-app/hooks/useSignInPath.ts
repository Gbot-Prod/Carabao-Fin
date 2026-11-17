"use client";

import { useSyncExternalStore } from "react";
import { signInPath, signInPathHere } from "@/lib/urls";

const noSubscribe = () => () => {};

/**
 * The sign-in page of the site the browser is on (site standard: buyer /auth,
 * merchant /login, admin /admin/login), for links on shared pages such as
 * /forgot-password. The server render uses the deploy default; the browser
 * then switches to the host's own page.
 */
export function useSignInPath(next?: string | null): string {
  return useSyncExternalStore(
    noSubscribe,
    () => signInPathHere(next),
    () => signInPath(next),
  );
}
