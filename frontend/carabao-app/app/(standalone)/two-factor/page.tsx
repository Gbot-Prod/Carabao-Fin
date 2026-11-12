"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { completeTwoFactorSignIn } from "@/lib/auth-client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle/LanguageToggle";
import "../auth/page.css";

/** Second step of sign-in for accounts with two-step verification (E8b). */
export default function TwoFactorPage() {
  const { t } = useLanguage();
  const s = t.twoFactorSignIn;
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await completeTwoFactorSignIn(code.trim(), { backup: useBackup, trustDevice });
      // Full load so every hook re-reads the new session.
      window.location.assign("/");
    } catch (err) {
      if (err instanceof Error && err.message === "SIGN_IN_AGAIN") setExpired(true);
      else setError(err instanceof Error && err.message ? err.message : t.reset.genericError);
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
            <h2>{s.title}</h2>
          </div>

          {expired ? (
            <div className="auth-error" role="alert">{s.expired}</div>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <div className="auth-fields">
                <p className="auth-help">{useBackup ? s.backupBody : s.body}</p>
                {error && <div className="auth-error" role="alert">{error}</div>}
                <input
                  className="auth-input"
                  aria-label={useBackup ? s.backupLabel : s.codeLabel}
                  placeholder={useBackup ? s.backupLabel : s.codeLabel}
                  inputMode={useBackup ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  pattern={useBackup ? undefined : "[0-9]{6}"}
                  maxLength={useBackup ? 32 : 6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <label className="auth-check">
                  <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
                  {s.trustDevice}
                </label>
              </div>
              <button type="submit" className="auth-submit" disabled={busy}>
                {busy ? t.auth.pleaseWait : s.verify}
              </button>
              <button
                type="button"
                className="auth-link auth-link--button"
                onClick={() => { setUseBackup(!useBackup); setCode(""); setError(""); }}
              >
                {useBackup ? s.useApp : s.useBackup}
              </button>
            </form>
          )}
          <Link href="/auth" className="auth-link">{s.backToSignIn}</Link>
        </div>
      </section>
    </div>
  );
}
