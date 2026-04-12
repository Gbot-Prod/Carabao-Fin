"use client";

import { ReactNode } from "react";

export function AuthProvider({ children }: { children: ReactNode }) {
  // BetterAuth doesn't require a provider - hooks work directly
  return <>{children}</>;
}
