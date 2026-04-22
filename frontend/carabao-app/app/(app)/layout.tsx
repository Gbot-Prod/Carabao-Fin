"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/sidebar/sidebar";
import AuthPrompt from "@/components/AuthPrompt/AuthPrompt";
import { useAuth } from "@/hooks/useAuth";

const PROTECTED_ROUTES = ["/track", "/history", "/profile", "/checkout", "/confirmation"];

function isProtected(path: string) {
  return PROTECTED_ROUTES.some((route) => path === route || path.startsWith(route + "/"));
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal whenever the user navigates to a new protected route.
  useEffect(() => {
    setDismissed(false);
  }, [pathname]);

  const showPrompt = !isLoading && !isAuthenticated && isProtected(pathname) && !dismissed;

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-shell__content">{children}</main>
      {showPrompt && <AuthPrompt onDismiss={() => setDismissed(true)} />}
    </div>
  );
}
