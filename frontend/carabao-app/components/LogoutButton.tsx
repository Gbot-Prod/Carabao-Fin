"use client";

import { signOut } from "@/lib/auth-client";
import { signInPathHere } from "@/lib/urls";
import { useState } from "react";

export function LogoutButton({ className, children }: { className?: string; children?: React.ReactNode } = {}) {
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      await signOut();
      // This site's own sign-in page; a full load drops the old session's state.
      window.location.assign(signInPathHere());
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={isLoading}
      className={className}
    >
      {isLoading ? "Logging out…" : (children ?? "Logout")}
    </button>
  );
}
