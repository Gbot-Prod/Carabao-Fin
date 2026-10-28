"use client";

import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { resendVerificationEmail } from "@/lib/auth-client";
import styles from "./page.module.css";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error" | "already_verified">("idle");

  const handleResend = async () => {
    if (!email) return;
    setStatus("sending");
    try {
      await resendVerificationEmail(email);
      setStatus("sent");
    } catch (err) {
      if (err instanceof Error && err.message === "ALREADY_VERIFIED") {
        setStatus("already_verified");
      } else {
        setStatus("error");
      }
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>

        <div className={styles.icon}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#31925d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
        </div>

        <h1 className={styles.title}>Check your email</h1>
        <p className={styles.lead}>
          We sent a verification link to
        </p>
        {email && (
          <p className={styles.email}>
            {email}
          </p>
        )}
        <p className={styles.hint}>
          Click the link in that email to verify your account and continue to onboarding.
        </p>

        {status === "sent" && (
          <p className={`${styles.notice} ${styles.noticeSuccess}`}>
            Verification email resent.
          </p>
        )}
        {status === "already_verified" && (
          <p className={`${styles.notice} ${styles.noticeWarning}`}>
            This email is already verified. <a href="/auth">Sign in instead.</a>
          </p>
        )}
        {status === "error" && (
          <p className={`${styles.notice} ${styles.noticeError}`}>
            Could not resend. Please try again.
          </p>
        )}

        <button
          onClick={handleResend}
          disabled={status === "sending" || !email}
          className={styles.resendButton}
        >
          {status === "sending" ? "Sending…" : "Resend verification email"}
        </button>

        <p className={styles.footer}>
          Wrong email?{" "}
          <a href="/auth">
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
