"use client";

import { formatPhMobile, normalizePhMobile } from "@/lib/phone";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { MIN_PASSWORD, useAuthForm } from "@/hooks/useAuthForm";
import { FacebookIcon, GoogleIcon } from "@/components/SocialIcons";
import Logo from "@/public/images/icons/carabaoLogo.png";
import LanguageToggle from "@/components/LanguageToggle/LanguageToggle";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import "./page.css";
import { appUrl } from "@/lib/urls";

/**
 * Log in with a mobile number (or a verified email) and password, or with
 * Google / Facebook. Sign up with a mobile number, then a name and password,
 * then the 6-digit code we text: the code creates the account with the number
 * already verified.
 */
export default function AuthPage() {
  const router = useRouter();
  const { t } = useLanguage();
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
    busy,
    showSocial,
  } = useAuthForm({ defaultNext: "/", onSuccess: (_mode, next) => router.push(next) });

  return (
    <div className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand-content">
          <Image src={Logo} alt={t.auth.logoAlt} className="auth-brand-logo" priority />
          <h1>Carabao</h1>
          <p>{t.auth.brandTagline}</p>
        </div>
        <div className="auth-brand-orb auth-brand-orb-one" aria-hidden="true" />
        <div className="auth-brand-orb auth-brand-orb-three" aria-hidden="true" />
        <div className="auth-brand-orb auth-brand-orb-two" aria-hidden="true" />
        <div className="auth-brand-orb auth-brand-orb-four" aria-hidden="true" />
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-shell">
          <div className="auth-header auth-header--row">
            <h2>{isSignup ? t.auth.signUpTitle : t.auth.signInTitle}</h2>
            <LanguageToggle />
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate={isSignup && step === "phone"}>
            {idleNotice && !error && (
              <div className="auth-notice" role="status">
                {t.idle.signedOutNotice}
              </div>
            )}
            {error && (
              <div className="auth-error" role="alert" aria-live="polite">
                <div>{error}</div>
              </div>
            )}

            <div className="auth-fields">
              {!isSignup ? (
                <>
                  <input
                    id="identifier"
                    name="identifier"
                    type="text"
                    autoComplete="username"
                    required
                    className="auth-input"
                    aria-label={t.auth.signInIdentifier}
                    placeholder={t.auth.signInIdentifier}
                    value={form.identifier}
                    onChange={handleChange}
                  />
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="auth-input"
                    aria-label={t.auth.passwordPlaceholder}
                    placeholder={t.auth.passwordPlaceholder}
                    value={form.password}
                    onChange={handleChange}
                  />
                </>
              ) : step === "phone" ? (
                <div>
                  <div className={`auth-phone ${phoneInvalid ? "auth-phone--invalid" : ""}`}>
                    <span className="auth-phone-prefix">+63</span>
                    <input
                      id="phoneNumber"
                      name="phoneNumber"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      className="auth-phone-input"
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
                    <p id="phone-error" className="auth-field-error">
                      {t.auth.invalidPhone}
                    </p>
                  )}
                </div>
              ) : step === "code" ? (
                <>
                  <p className="auth-help">
                    {t.auth.codeSentTo.replace("{phone}", formatPhMobile(normalizePhMobile(form.phoneNumber)))}{" "}
                    <button type="button" className="auth-inline-link" onClick={() => setStep("phone")}>
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
                    className="auth-input"
                    aria-label={t.auth.codePlaceholder}
                    placeholder={t.auth.codePlaceholder}
                    value={form.code}
                    onChange={handleChange}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="auth-inline-link auth-link--right"
                    disabled={busy}
                    onClick={() => void sendCode()}
                  >
                    {t.auth.resendCode}
                  </button>
                </>
              ) : (
                <>
                  <p className="auth-help">
                    {t.auth.accountFor.replace("{phone}", formatPhMobile(normalizePhMobile(form.phoneNumber)))}{" "}
                    <button type="button" className="auth-inline-link" onClick={() => setStep("phone")}>
                      {t.auth.changeNumber}
                    </button>
                  </p>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    className="auth-input"
                    aria-label={t.auth.namePlaceholder}
                    placeholder={t.auth.namePlaceholder}
                    value={form.name}
                    onChange={handleChange}
                    autoFocus
                  />
                  <input
                    id="new-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD}
                    className="auth-input"
                    aria-label={t.auth.passwordPlaceholder}
                    placeholder={t.auth.passwordPlaceholder}
                    value={form.password}
                    onChange={handleChange}
                  />
                  <input
                    id="confirm-password"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="auth-input"
                    aria-label={t.auth.confirmPasswordPlaceholder}
                    placeholder={t.auth.confirmPasswordPlaceholder}
                    value={form.confirmPassword}
                    onChange={handleChange}
                  />
                </>
              )}
            </div>

            {!isSignup && (
              <a href="/forgot-password" className="auth-link auth-link--right">{t.reset.forgotLink}</a>
            )}

            <button type="submit" disabled={busy} className="auth-submit">
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
            <label className="auth-remember">
              <input
                type="checkbox"
                className="auth-terms-checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>{t.auth.staySignedIn}</span>
              <span className="auth-hint" title={t.auth.staySignedInHint} aria-label={t.auth.staySignedInHint} role="img">
                ?
              </span>
            </label>
            )}
          </form>

          {showSocial && (
            <>
              <div className="auth-divider" role="separator">
                <span>{t.auth.or}</span>
              </div>
              <div className="auth-social">
                {(["facebook", "google"] as const).map((provider) => {
                  const name = provider === "google" ? "Google" : "Facebook";
                  return (
                    <button
                      key={provider}
                      type="button"
                      className="auth-social-btn"
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

          {isSignup && (
            <p className="auth-terms-notice">
              {t.auth.termsNotice}{" "}
              {/* /terms and /privacy are public; a new tab keeps a half-filled signup. */}
              <a href={appUrl("/terms")} target="_blank" rel="noopener" className="auth-terms-link">
                {t.auth.termsLink}
              </a>{" "}
              {t.auth.and}{" "}
              <a href={appUrl("/privacy")} target="_blank" rel="noopener" className="auth-terms-link">
                {t.auth.privacyLink}
              </a>
            </p>
          )}

          <p className="auth-switch-line">
            {isSignup ? t.auth.haveAccount : t.auth.noAccount}{" "}
            <button
              type="button"
              className="auth-inline-link"
              onClick={() => switchMode(isSignup ? "signin" : "signup")}
            >
              {isSignup ? t.auth.signIn : t.auth.signUp}
            </button>
          </p>
        </div>
      </section>
    </div>
  );
}
