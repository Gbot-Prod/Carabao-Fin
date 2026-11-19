"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle/LanguageToggle";
import { FacebookIcon, GoogleIcon } from "@/components/SocialIcons";
import { useAuth } from "@/hooks/useAuth";
import { MIN_PASSWORD, useAuthForm } from "@/hooks/useAuthForm";
import { formatCountdown } from "@/hooks/useResendCooldown";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { formatPhMobile, normalizePhMobile } from "@/lib/phone";
import { helpUrl } from "@/lib/urls";
import styles from "./AuthForm.module.css";

type Props = Parameters<typeof useAuthForm>[0] & {
  /** A line above the phone field on the first signup step. */
  signUpHint?: string;
  /** A signed-in visitor goes on to ?next= (or defaultNext) at once. */
  redirectIfSignedIn?: boolean;
  /** Extra class on the card, e.g. to set the --af-* colour tokens. */
  className?: string;
};

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
        aria-label={visible ? t.auth.hidePassword : t.auth.showPassword}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
      </button>
    </div>
  );
}

/**
 * The one sign-in / sign-up card, for the buyer page (/auth) and the merchant
 * login page. The pages give only the frame around it and where to go after.
 *
 * Log in with a mobile number (or a verified email) and password, or with
 * Google / Facebook. Sign up with a mobile number, then a name and password,
 * then the 6-digit code we text: the code creates the account with the number
 * already verified. The steps are in hooks/useAuthForm.ts.
 */
export default function AuthForm({ signUpHint, redirectIfSignedIn, className, ...options }: Props) {
  const { t } = useLanguage();
  const { isAuthenticated, isLoading: sessionLoading } = useAuth();
  const {
    isSignup,
    step,
    setStep,
    form,
    handleChange,
    switchMode,
    sendCode,
    resendIn,
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
  } = useAuthForm(options);

  useEffect(() => {
    if (redirectIfSignedIn && !sessionLoading && isAuthenticated) window.location.replace(nextPath);
  }, [redirectIfSignedIn, sessionLoading, isAuthenticated, nextPath]);

  const phone = formatPhMobile(normalizePhMobile(form.phoneNumber));

  return (
    <section className={`${styles.card} ${className ?? ""}`} aria-labelledby="auth-form-title">
      <div className={styles.header}>
        <h2 id="auth-form-title">{isSignup ? t.auth.signUpTitle : t.auth.signInTitle}</h2>
        <LanguageToggle />
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate={isSignup && step === "phone"}>
        {idleNotice && !error && (
          <div className={styles.notice} role="status">{t.idle.signedOutNotice}</div>
        )}
        {error && (
          <div className={styles.error} role="alert" aria-live="polite">{error}</div>
        )}
        {isSignup && step === "phone" && signUpHint && <p className={styles.help}>{signUpHint}</p>}

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
            <p className={styles.help}>
              {t.auth.codeSentTo.replace("{phone}", phone)}{" "}
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
              disabled={busy || resendIn > 0}
              onClick={() => void sendCode()}
              aria-live="polite"
            >
              {resendIn > 0 ? t.auth.resendCodeIn.replace("{time}", formatCountdown(resendIn)) : t.auth.resendCode}
            </button>
          </>
        ) : (
          <>
            <p className={styles.help}>
              {t.auth.accountFor.replace("{phone}", phone)}{" "}
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
        {isSignup ? t.auth.termsNotice : t.auth.signInTerms}{" "}
        {/* Terms and Privacy are on the help site; a new tab keeps a half-filled form. */}
        <a href={helpUrl("/terms")} target="_blank" rel="noopener">{t.auth.termsLink}</a>{" "}
        {t.auth.and}{" "}
        <a href={helpUrl("/privacy")} target="_blank" rel="noopener">{t.auth.privacyLink}</a>
      </p>

      <p className={styles.switchLine}>
        {isSignup ? t.auth.haveAccount : t.auth.noAccount}{" "}
        <button type="button" className={styles.switchBtn} onClick={() => switchMode(isSignup ? "signin" : "signup")}>
          {isSignup ? t.auth.signIn : t.auth.signUp}
        </button>
      </p>
    </section>
  );
}
