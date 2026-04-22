"use client";

import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { resendVerificationEmail } from "@/lib/auth-client";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const handleResend = async () => {
    if (!email) return;
    setStatus("sending");
    try {
      await resendVerificationEmail(email);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #f7fcf8 0%, #ecf6ef 100%)", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 16, padding: "40px 32px", width: "100%", maxWidth: 440, boxShadow: "0 4px 20px rgba(0,0,0,0.10)", textAlign: "center" }}>

        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#e8f5ec", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#31925d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#173d25", margin: "0 0 8px" }}>Check your email</h1>
        <p style={{ fontSize: 14, color: "#647067", margin: "0 0 6px" }}>
          We sent a verification link to
        </p>
        {email && (
          <p style={{ fontSize: 14, fontWeight: 600, color: "#173d25", margin: "0 0 24px", wordBreak: "break-all" }}>
            {email}
          </p>
        )}
        <p style={{ fontSize: 13, color: "#8a9a8c", margin: "0 0 28px" }}>
          Click the link in that email to verify your account and continue to onboarding.
        </p>

        {status === "sent" && (
          <p style={{ fontSize: 13, color: "#31925d", margin: "0 0 16px", padding: "10px 14px", background: "#e8f5ec", borderRadius: 8 }}>
            Verification email resent.
          </p>
        )}
        {status === "error" && (
          <p style={{ fontSize: 13, color: "#b91c1c", margin: "0 0 16px", padding: "10px 14px", background: "#fdecea", borderRadius: 8 }}>
            Could not resend. Please try again.
          </p>
        )}

        <button
          onClick={handleResend}
          disabled={status === "sending" || !email}
          style={{
            width: "100%",
            padding: "11px 0",
            background: "white",
            color: "#31925d",
            border: "1.5px solid #31925d",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: status === "sending" || !email ? "not-allowed" : "pointer",
            opacity: status === "sending" ? 0.6 : 1,
            fontFamily: "inherit",
          }}
        >
          {status === "sending" ? "Sending…" : "Resend verification email"}
        </button>

        <p style={{ marginTop: 20, fontSize: 13, color: "#8a9a8c" }}>
          Wrong email?{" "}
          <a href="/auth" style={{ color: "#31925d", textDecoration: "underline" }}>
            Go back and sign up again
          </a>
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
