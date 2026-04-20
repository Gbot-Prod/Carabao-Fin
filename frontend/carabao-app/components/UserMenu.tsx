"use client";

import { useAuth } from "@/hooks/useAuth";
import Link from "next/link";
import { LogoutButton } from "./LogoutButton";

export function UserMenu() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="text-sm text-gray-600">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="flex gap-4">
        <Link href="/auth" className="text-sm text-blue-600 hover:text-blue-700">
          Auth
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="text-sm">
        <p className="font-medium text-gray-900">{user.name}</p>
        <p className="text-gray-600">{user.email}</p>
      </div>
      <LogoutButton />
    </div>
  );
}
