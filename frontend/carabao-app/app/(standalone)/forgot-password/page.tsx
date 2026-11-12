"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { requestPasswordReset } from "@/lib/auth-client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle/LanguageToggle";
import "../auth/page.css";

/** Web forgot-password (E6): BetterAuth emails a reset link. */
export default function ForgotPasswordPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch {
      setError(t.reset.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page auth-page--single">
      <section className="auth-form-panel">
        <div className="auth-form-shell">
          <div className="auth-header">
            <div className="auth-kicker-row">
              <p className="auth-kicker">Carabao</p>
              <LanguageToggle />
            </div>
            <h2>{t.reset.forgotTitle}</h2>
          </div>
          {sent ? (
            <div className="auth-notice" role="status">{t.reset.sent}</div>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <div className="auth-fields">
                <p className="auth-help">{t.reset.forgotBody}</p>
                {error && <div className="auth-error" role="alert">{error}</div>}
                <input
                  type="email"
                  autoComplete="email"
                  required
                  className="auth-input"
                  placeholder={t.auth.emailPlaceholder}
                  aria-label={t.auth.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button type="submit" className="auth-submit" disabled={busy}>
                {busy ? t.auth.pleaseWait : t.reset.send}
              </button>
            </form>
          )}
          <Link href="/auth" className="auth-link">{t.reset.backToSignIn}</Link>
        </div>
      </section>
    </div>
  );
}
