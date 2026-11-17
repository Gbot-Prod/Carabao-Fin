"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Eye, EyeOff } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle/LanguageToggle";
import { FacebookIcon, GoogleIcon } from "@/components/SocialIcons";
import { MIN_PASSWORD, useAuthForm } from "@/hooks/useAuthForm";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { MERCHANT_PAGES as P } from "@/lib/merchant-links";
import { formatPhMobile, normalizePhMobile } from "@/lib/phone";
import { appUrl, merchantUrl } from "@/lib/urls";
import { merchantLoginUrl } from "../lib/signIn";
import MerchantTopBar from "../MerchantTopBar";
import StallIllustration from "./StallIllustration";
import styles from "./page.module.css";

/** A URL on this host, made absolute: OAuth returns to it from the apex. */
const absolute = (url: string) => new URL(url, window.location.origin).href;

function PasswordInput({
  id,
  name,
  autoComplete,
  placeholder,
  value,
  onChange,
  minLength,
}: {
  id: string;
  name: string;
  autoComplete: string;
  placeholder: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  minLength?: number;
}) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  return (
    <div className={styles.passwordWrap}>
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        className={styles.input}
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        className={styles.eye}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t.merchantAuth.hidePassword : t.merchantAuth.showPassword}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
      </button>
    </div>
  );
}

/**
 * Merchant Centre login (merchant.<root>/login). The same accounts as the
 * buyer site: a new account goes on to the merchant application (onboarding).
 */
export default function MerchantLoginPage() {
  const { t } = useLanguage();
  const m = t.merchantAuth;
  const { isAuthenticated, isLoading: sessionLoading } = useAuth();
  const {
    isSignup,
    step,
    setStep,
    form,
    handleChange,
    switchMode,
    sendCode,
    continueWith,
    handleSubmit,
    rememberMe,
    setRememberMe,
    phoneInvalid,
    error,
    isLoading,
    socialLoading,
    idleNotice,
    nextPath,
    busy,
    showSocial,
  } = useAuthForm({
    defaultNext: merchantUrl("/"),
    // A full page load, so the merchant pages load the new session's data.
    onSuccess: (mode, next) => window.location.assign(mode === "signup" ? merchantUrl(P.onboarding) : next),
    socialUrls: (next) => ({
      callbackURL: absolute(next),
      errorCallbackURL: absolute(merchantLoginUrl(next)),
    }),
  });

  // Already signed in: go on to the merchant pages.
  useEffect(() => {
    if (!sessionLoading && isAuthenticated) window.location.replace(nextPath);
  }, [sessionLoading, isAuthenticated, nextPath]);

  const year = new Date().getFullYear();

  return (
    <div className={styles.page}>
      <MerchantTopBar />

      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.heroTitle}>{m.heroTitle}</h1>
          <p className={styles.heroBody}>{m.heroBody}</p>
          <StallIllustration className={styles.illustration} />
        </section>

        <div className={styles.column}>
          <section className={styles.card} aria-labelledby="merchant-auth-title">
            <div className={styles.cardHeader}>
              <h2 id="merchant-auth-title">{isSignup ? t.auth.signUpTitle : t.auth.signInTitle}</h2>
              <LanguageToggle />
            </div>

            <form className={styles.form} onSubmit={handleSubmit} noValidate={isSignup && step === "phone"}>
              {idleNotice && !error && (
                <div className={styles.notice} role="status">{t.idle.signedOutNotice}</div>
              )}
              {error && (
                <div className={styles.error} role="alert" aria-live="polite">{error}</div>
              )}
              {isSignup && step === "phone" && <p className={styles.help2}>{m.signUpHint}</p>}

              {!isSignup ? (
                <>
                  <input
                    id="identifier"
                    name="identifier"
                    type="text"
                    autoComplete="username"
                    required
                    className={styles.input}
                    aria-label={t.auth.signInIdentifier}
                    placeholder={t.auth.signInIdentifier}
                    value={form.identifier}
                    onChange={handleChange}
                  />
                  <PasswordInput
                    id="password"
                    name="password"
                    autoComplete="current-password"
                    placeholder={t.auth.passwordPlaceholder}
                    value={form.password}
                    onChange={handleChange}
                  />
                </>
              ) : step === "phone" ? (
                <div>
                  <div className={`${styles.phone} ${phoneInvalid ? styles.phoneInvalid : ""}`}>
                    <span className={styles.phonePrefix}>+63</span>
                    <input
                      id="phoneNumber"
                      name="phoneNumber"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      className={styles.phoneInput}
                      aria-label={t.auth.phoneLabel}
                      aria-invalid={phoneInvalid}
                      aria-describedby={phoneInvalid ? "phone-error" : undefined}
                      placeholder={t.auth.phonePlaceholder}
                      value={form.phoneNumber}
                      onChange={handleChange}
                      maxLength={13}
                      autoFocus
                    />
                  </div>
                  {phoneInvalid && (
                    <p id="phone-error" className={styles.fieldError}>{t.auth.invalidPhone}</p>
                  )}
                </div>
              ) : step === "code" ? (
                <>
                  <p className={styles.help2}>
                    {t.auth.codeSentTo.replace("{phone}", formatPhMobile(normalizePhMobile(form.phoneNumber)))}{" "}
                    <button type="button" className={styles.inlineLink} onClick={() => setStep("phone")}>
                      {t.auth.changeNumber}
                    </button>
                  </p>
                  <input
                    id="code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    className={styles.input}
                    aria-label={t.auth.codePlaceholder}
                    placeholder={t.auth.codePlaceholder}
                    value={form.code}
                    onChange={handleChange}
                    autoFocus
                  />
                  <button
                    type="button"
                    className={`${styles.inlineLink} ${styles.right}`}
                    disabled={busy}
                    onClick={() => void sendCode()}
                  >
                    {t.auth.resendCode}
                  </button>
                </>
              ) : (
                <>
                  <p className={styles.help2}>
                    {t.auth.accountFor.replace("{phone}", formatPhMobile(normalizePhMobile(form.phoneNumber)))}{" "}
                    <button type="button" className={styles.inlineLink} onClick={() => setStep("phone")}>
                      {t.auth.changeNumber}
                    </button>
                  </p>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    className={styles.input}
                    aria-label={t.auth.namePlaceholder}
                    placeholder={t.auth.namePlaceholder}
                    value={form.name}
                    onChange={handleChange}
                    autoFocus
                  />
                  <PasswordInput
                    id="new-password"
                    name="password"
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD}
                    placeholder={t.auth.passwordPlaceholder}
                    value={form.password}
                    onChange={handleChange}
                  />
                  <PasswordInput
                    id="confirm-password"
                    name="confirmPassword"
                    autoComplete="new-password"
                    placeholder={t.auth.confirmPasswordPlaceholder}
                    value={form.confirmPassword}
                    onChange={handleChange}
                  />
                </>
              )}

              <button type="submit" disabled={busy} className={styles.submit}>
                {isLoading
                  ? t.auth.pleaseWait
                  : !isSignup
                    ? t.auth.signIn
                    : step === "phone"
                      ? t.auth.next
                      : step === "details"
                        ? t.auth.sendCode
                        : t.auth.createAccount}
              </button>

              {!isSignup && (
                <div className={styles.row}>
                  <label className={styles.remember}>
                    <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                    <span title={t.auth.staySignedInHint}>{t.auth.staySignedIn}</span>
                  </label>
                  <a href="/forgot-password" className={styles.link}>{t.reset.forgotLink}</a>
                </div>
              )}
            </form>

            {showSocial && (
              <>
                <div className={styles.divider} role="separator">
                  <span>{t.auth.or}</span>
                </div>
                <div className={styles.social}>
                  {(["facebook", "google"] as const).map((provider) => {
                    const name = provider === "google" ? "Google" : "Facebook";
                    return (
                      <button
                        key={provider}
                        type="button"
                        className={styles.socialBtn}
                        disabled={busy}
                        aria-label={t.auth.continueWith.replace("{provider}", name)}
                        onClick={() => void continueWith(provider)}
                      >
                        {provider === "google" ? <GoogleIcon /> : <FacebookIcon />}
                        <span>{socialLoading === provider ? t.auth.pleaseWait : name}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <p className={styles.terms}>
              {isSignup ? t.auth.termsNotice : m.signInTerms}{" "}
              {/* A new tab keeps a half-filled form. */}
              <a href={appUrl("/terms")} target="_blank" rel="noopener">{t.auth.termsLink}</a>{" "}
              {t.auth.and}{" "}
              <a href={appUrl("/privacy")} target="_blank" rel="noopener">{t.auth.privacyLink}</a>
            </p>

            <p className={styles.switchLine}>
              {isSignup ? t.auth.haveAccount : t.auth.noAccount}{" "}
              <button
                type="button"
                className={styles.switchBtn}
                onClick={() => switchMode(isSignup ? "signin" : "signup")}
              >
                {isSignup ? t.auth.signIn : t.auth.signUp}
              </button>
            </p>
          </section>

          <a className={styles.buyerLink} href={appUrl("/")}>
            {m.buyerLink}
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
      </main>

      <footer className={styles.footer}>© {year} Carabao. {m.rights}</footer>
    </div>
  );
}
