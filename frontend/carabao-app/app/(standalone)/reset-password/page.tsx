"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { resetPassword } from "@/lib/auth-client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle/LanguageToggle";
import "../auth/page.css";

const MIN_LENGTH = 8;

/** Where BetterAuth's emailed link lands: ?token=... or ?error=INVALID_TOKEN (E6). */
export default function ResetPasswordPage() {
  const { t } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("token");
    queueMicrotask(() => {
      if (value && !params.get("error")) setToken(value);
      else setInvalid(true);
    });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password.length < MIN_LENGTH) return setError(t.reset.tooShort);
    if (password !== confirm) return setError(t.reset.mismatch);
    setBusy(true);
    setError("");
    try {
      await resetPassword(password, token);
      setDone(true);
    } catch (err) {
      if (err instanceof Error && err.message === "INVALID_TOKEN") setInvalid(true);
      else setError(t.reset.genericError);
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
            <h2>{t.reset.newTitle}</h2>
          </div>
          {done ? (
            <>
              <div className="auth-notice" role="status">{t.reset.done}</div>
              <Link href="/auth" className="auth-submit auth-submit--link">{t.auth.signIn}</Link>
            </>
          ) : invalid ? (
            <>
              <div className="auth-error" role="alert">{t.reset.invalidLink}</div>
              <Link href="/forgot-password" className="auth-link">{t.reset.requestNew}</Link>
            </>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <div className="auth-fields">
                {error && <div className="auth-error" role="alert">{error}</div>}
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MIN_LENGTH}
                  className="auth-input"
                  placeholder={t.reset.newPassword}
                  aria-label={t.reset.newPassword}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  className="auth-input"
                  placeholder={t.reset.confirmPassword}
                  aria-label={t.reset.confirmPassword}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <button type="submit" className="auth-submit" disabled={busy || !token}>
                {busy ? t.auth.pleaseWait : t.reset.save}
              </button>
            </form>
          )}
          {!done && <Link href="/auth" className="auth-link">{t.reset.backToSignIn}</Link>}
        </div>
      </section>
    </div>
  );
}
