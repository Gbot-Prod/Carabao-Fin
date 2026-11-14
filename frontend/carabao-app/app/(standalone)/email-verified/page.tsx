"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/util/api/client";
import "./page.css";

export default function EmailVerifiedPage() {
  const router = useRouter();
  const [error, setError] = useState(false);

  useEffect(() => {
    const syncAndRedirect = async () => {
      try {
        // The first backend call creates the account's backend row.
        await apiClient.get("/auth/me");
        router.replace("/onboarding");
      } catch {
        setError(true);
      }
    };

    void syncAndRedirect();
  }, [router]);

  if (error) {
    return (
      <div className="email-verified-error-page">
        <div className="email-verified-error-card">
          <p className="email-verified-error-message">Something went wrong completing your signup.</p>
          <a href="/auth" className="email-verified-error-link">Return to sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="email-verified-page">
      <div className="email-verified-container">
        <div className="email-verified-icon-wrapper">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#31925d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="email-verified-title">Email verified!</p>
        <p className="email-verified-subtitle">Setting up your account…</p>
      </div>
    </div>
  );
}
