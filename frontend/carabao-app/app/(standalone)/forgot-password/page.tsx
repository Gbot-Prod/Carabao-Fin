"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { requestPasswordReset, requestPhonePasswordReset, resetPasswordWithPhone } from "@/lib/auth-client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle/LanguageToggle";
import "../auth/page.css";

const MIN_PASSWORD = 8;

/**
 * Forgot password (E6): a texted code by default; an emailed link for accounts
 * that added and verified an email. Neither says whether an account exists.
 */
export default function ForgotPasswordPage() {
  const { t } = useLanguage();
  const [channel, setChannel] = useState<"phone" | "email">("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t.reset.genericError);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (channel === "email") {
      return void run(async () => {
        await requestPasswordReset(email.trim());
        setEmailSent(true);
      });
    }
    if (!codeSent) {
      return void run(async () => {
        await requestPhonePasswordReset(phoneNumber);
        setCodeSent(true);
      });
    }
    if (password.length < MIN_PASSWORD) return setError(t.reset.tooShort);
    if (password !== confirm) return setError(t.reset.mismatch);
    void run(async () => {
      await resetPasswordWithPhone({ phoneNumber, code, newPassword: password });
      setDone(true);
    });
  };

  const switchChannel = () => {
    setChannel(channel === "phone" ? "email" : "phone");
    setError("");
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
          {done ? (
            <div className="auth-notice" role="status">{t.reset.done}</div>
          ) : emailSent ? (
            <div className="auth-notice" role="status">{t.reset.sent}</div>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <div className="auth-fields">
                <p className="auth-help">
                  {channel === "email" ? t.reset.forgotBody : codeSent ? t.reset.codeSent : t.reset.phoneBody}
                </p>
                {error && <div className="auth-error" role="alert">{error}</div>}
                {channel === "email" ? (
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
                ) : (
                  <>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      required
                      className="auth-input"
                      placeholder={t.auth.phoneLabel}
                      aria-label={t.auth.phoneLabel}
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      disabled={codeSent}
                    />
                    {codeSent && (
                      <>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          required
                          pattern="[0-9]{6}"
                          maxLength={6}
                          className="auth-input"
                          placeholder={t.auth.codePlaceholder}
                          aria-label={t.auth.codePlaceholder}
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                        <input
                          type="password"
                          autoComplete="new-password"
                          required
                          minLength={MIN_PASSWORD}
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
                      </>
                    )}
                  </>
                )}
              </div>
              <button type="submit" className="auth-submit" disabled={busy}>
                {busy
                  ? t.auth.pleaseWait
                  : channel === "email"
                    ? t.reset.send
                    : codeSent
                      ? t.reset.save
                      : t.reset.sendCode}
              </button>
              {!codeSent && (
                <button type="button" className="auth-link" onClick={switchChannel}>
                  {channel === "phone" ? t.reset.useEmail : t.reset.usePhone}
                </button>
              )}
            </form>
          )}
          <Link href="/auth" className="auth-link">{t.reset.backToSignIn}</Link>
        </div>
      </section>
    </div>
  );
}
