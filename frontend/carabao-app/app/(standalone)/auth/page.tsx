"use client";

import { isValidPhone, sendPhoneCode, signIn, signUpWithPhone, socialErrorMessage } from "@/lib/auth-client";
import { formatPhMobile, normalizePhMobile } from "@/lib/phone";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "@/public/images/icons/carabaoLogo.png";
import LanguageToggle from "@/components/LanguageToggle/LanguageToggle";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import "./page.css";

const MIN_PASSWORD = 8;

type Provider = "google" | "facebook";

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path
        fill="#fff"
        d="M15.12 15.47 15.65 12H12.3V9.75c0-.95.47-1.88 1.97-1.88h1.52V4.92s-1.38-.24-2.7-.24c-2.76 0-4.56 1.67-4.56 4.69V12H5.48v3.47h3.05V24a12.1 12.1 0 0 0 3.77 0v-8.53h2.82Z"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}

/**
 * Log in with a mobile number (or a verified email) and password, or with
 * Google / Facebook. Sign up with a mobile number, then a name and password,
 * then the 6-digit code we text: the code creates the account with the number
 * already verified.
 */
export default function AuthPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [authMode, setMode] = useState<"signin" | "signup">("signin");
  const [step, setStep] = useState<"phone" | "details" | "code">("phone");
  const [form, setForm] = useState({
    identifier: "",
    phoneNumber: "",
    name: "",
    code: "",
    password: "",
    confirmPassword: "",
  });
  const [rememberMe, setRememberMe] = useState(true);
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<Provider | null>(null);
  const [idleNotice, setIdleNotice] = useState(false);

  // "Create an account" links (E4) open the page on sign-up; ?reason=idle (E5)
  // explains an automatic sign-out; ?error= is a failed Google/Facebook sign-in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    queueMicrotask(() => {
      if (params.get("mode") === "signup") setMode("signup");
      if (params.get("reason") === "idle") setIdleNotice(true);
      const socialError = params.get("error");
      if (socialError) setError(socialErrorMessage(socialError));
    });
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.name === "phoneNumber") setPhoneInvalid(false);
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const switchMode = (mode: "signin" | "signup") => {
    setMode(mode);
    setStep("phone");
    setForm((f) => ({ ...f, code: "" }));
    setPhoneInvalid(false);
    setError("");
  };

  const sendCode = async () => {
    setError("");
    setIsLoading(true);
    try {
      await sendPhoneCode(form.phoneNumber);
      setForm((f) => ({ ...f, code: "" }));
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.genericError);
    } finally {
      setIsLoading(false);
    }
  };

  const continueWith = async (provider: Provider) => {
    setError("");
    setSocialLoading(provider);
    try {
      await signIn.social(provider);
      // The browser is on its way to the provider; leave the buttons disabled.
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.genericError);
      setSocialLoading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (authMode === "signup" && step === "phone") {
      if (!isValidPhone(form.phoneNumber)) return setPhoneInvalid(true);
      return setStep("details");
    }
    if (authMode === "signup" && step === "details") {
      if (form.password.length < MIN_PASSWORD) return setError(t.auth.passwordTooShort);
      if (form.password !== form.confirmPassword) return setError(t.auth.passwordMismatch);
      return sendCode();
    }
    if (authMode === "signup" && !/^\d{6}$/.test(form.code.trim())) return setError(t.auth.codeInvalid);

    setIsLoading(true);
    try {
      if (authMode === "signin") {
        const identifier = form.identifier.trim();
        const credentials = { password: form.password, rememberMe };
        const result = identifier.includes("@")
          ? await signIn.email({ email: identifier, ...credentials })
          : await signIn.phone({ phoneNumber: identifier, ...credentials });
        // Two-step verification: the client plugin opens /two-factor (E8b).
        if ("twoFactorRedirect" in result && result.twoFactorRedirect) return;
      } else {
        await signUpWithPhone({
          phoneNumber: form.phoneNumber,
          code: form.code,
          name: form.name,
          password: form.password,
        });
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.genericError);
    } finally {
      setIsLoading(false);
    }
  };

  const busy = isLoading || socialLoading !== null;
  const isSignup = authMode === "signup";
  const showSocial = !isSignup || step === "phone";

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
              {/* /help is public; a new tab keeps a half-filled signup. */}
              <a href="/help?section=terms" target="_blank" rel="noopener" className="auth-terms-link">
                {t.auth.termsLink}
              </a>{" "}
              {t.auth.and}{" "}
              <a href="/help?section=privacy" target="_blank" rel="noopener" className="auth-terms-link">
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
