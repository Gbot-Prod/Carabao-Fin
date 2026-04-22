"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function EmailVerifiedPage() {
  const router = useRouter();
  const [error, setError] = useState(false);

  useEffect(() => {
    const syncAndRedirect = async () => {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          setError(true);
          return;
        }
        router.replace("/onboarding");
      } catch {
        setError(true);
      }
    };

    void syncAndRedirect();
  }, [router]);

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #f7fcf8 0%, #ecf6ef 100%)", padding: 16 }}>
        <div style={{ background: "white", borderRadius: 16, padding: "40px 32px", width: "100%", maxWidth: 400, boxShadow: "0 4px 20px rgba(0,0,0,0.10)", textAlign: "center" }}>
          <p style={{ color: "#b91c1c", marginBottom: 16 }}>Something went wrong completing your signup.</p>
          <a href="/auth" style={{ color: "#31925d", fontSize: 14, textDecoration: "underline" }}>Return to sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #f7fcf8 0%, #ecf6ef 100%)" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#e8f5ec", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#31925d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p style={{ color: "#173d25", fontWeight: 600, fontSize: 16, margin: 0 }}>Email verified!</p>
        <p style={{ color: "#647067", fontSize: 14, marginTop: 6 }}>Setting up your account…</p>
      </div>
    </div>
  );
}
