"use client";

import { signOut } from "@/lib/auth-client";
import { signInPath } from "@/lib/urls";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton({ className, children }: { className?: string; children?: React.ReactNode } = {}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      await signOut();
      router.push(signInPath());
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
