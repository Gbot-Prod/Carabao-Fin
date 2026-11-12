"use client";

import { signIn } from "@/lib/auth-client";
import { apiClient } from "@/util/api";
import { Mail, Phone } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "@/public/images/icons/carabaoLogo.png";
import LanguageToggle from "@/components/LanguageToggle/LanguageToggle";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import getApiErrorMessage from "@/util/errorHelper";
import "./page.css";

export default function SignupPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [authMode, setMode] = useState<"signin" | "signup">("signin");
  const [signUpMode, setSignUpMode] = useState<"number" | "email">("number");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    firstname: "",
    lastName: "",
    phoneNumber: "",
    verificationCode: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [verificationStep, setVerificationStep] = useState<"identifier" | "code">("identifier");

  const [idleNotice, setIdleNotice] = useState(false);

  // "Create an account" links (E4) open the page on sign-up; ?reason=idle (E5)
  // explains an automatic sign-out.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "signup") {
      queueMicrotask(() => setMode("signup"));
    }
    if (params.get("reason") === "idle") {
      queueMicrotask(() => setIdleNotice(true));
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (authMode === "signup") {
        const channel = signUpMode === "email" ? "email" : "phone";
        const identifier = signUpMode === "email" ? formData.email.trim() : formData.phoneNumber.trim();
        if (verificationStep === "identifier") {
          await apiClient.post("/auth/signup-verification/request", {
            channel,
            identifier,
          });
          setVerificationStep("code");
          return;
        }

        const response = await apiClient.post<{ verification_token: string }>(
          "/auth/signup-verification/verify",
          { channel, identifier, otp: formData.verificationCode }
        );
        document.cookie = `pending_signup_verification=${encodeURIComponent(response.data.verification_token)}; Path=/; Max-Age=1800; SameSite=Lax`;
        sessionStorage.setItem("pending_signup", JSON.stringify({ channel, identifier }));
        router.push("/onboarding?signup=1");
      } else {
        const result = await signIn.email({
          email: formData.email,
          password: formData.password,
        });
        // Two-step verification: the client plugin opens /two-factor (E8b).
        if ("twoFactorRedirect" in result && result.twoFactorRedirect) return;
        router.push("/");
      }
    } catch (err) {
      // Backend errors (e.g. 429 "Too many attempts. Please try again in 5 minutes.")
      // carry their reason in `detail`; BetterAuth errors arrive as Error messages.
      const message = getApiErrorMessage(err) ?? (err instanceof Error ? err.message : t.auth.genericError);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

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
          <div className="auth-header">
            <div className="auth-kicker-row">
              <p className="auth-kicker">{t.auth.welcome}</p>
              <LanguageToggle />
            </div>
            <h2>{authMode === "signup" ? t.auth.signUpTitle : t.auth.signInTitle}</h2>
            <div className="auth-header-buttons">
              <div className="auth-switch" role="tablist" aria-label={t.auth.modeLabel}>
                <button
                  type="button"
                  className={`auth-switch-btn ${authMode === "signin" ? "active" : ""}`}
                  onClick={() => { setMode("signin"); setVerificationStep("identifier"); setError(""); }}
                >
                  {t.auth.signIn}
                </button>
                <button
                  type="button"
                  className={`auth-switch-btn ${authMode === "signup" ? "active" : ""}`}
                  onClick={() => { setMode("signup"); setVerificationStep("identifier"); setError(""); }}
                >
                  {t.auth.signUp}
                </button>
              </div>

              {authMode === "signup" && (
                <div
                  className="signup-mode-switch"
                  role="tablist"
                  aria-label={t.auth.signUpModeLabel}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-label={t.auth.signUpWithPhone}
                    aria-selected={signUpMode === "number"}
                    title={t.auth.signUpWithPhone}
                    className={`signup-mode-btn ${signUpMode === "number" ? "active" : ""
                      }`}
                    onClick={() => setSignUpMode("number")}
                  >
                    <Phone aria-hidden="true" size={18} />
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-label={t.auth.signUpWithEmail}
                    aria-selected={signUpMode === "email"}
                    title={t.auth.signUpWithEmail}
                    className={`signup-mode-btn ${signUpMode === "email" ? "active" : ""
                      }`}
                    onClick={() => setSignUpMode("email")}
                  >
                    <Mail aria-hidden="true" size={18} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
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
              {authMode === "signup" ? (
                <>
                  {signUpMode === "email" && (
                    <>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        className="auth-input"
                        placeholder={t.auth.emailPlaceholder}
                        value={formData.email}
                        onChange={handleChange}
                        disabled={verificationStep === "code"}
                      />
                    </>
                  ) }
                  {signUpMode === "number" && (
                    <div className="phone-input-wrapper flex items-center gap-2">
                      <p className="auth-input w-2/12 bold">+63</p>
                      <input
                          id="phoneNumber"
                          name="phoneNumber"
                          type="tel"
                          autoComplete="number"
                          required
                          className="auth-input w-10/12"
                          placeholder="912 345 6789"
                          value={formData.phoneNumber}
                          onChange={handleChange}
                          disabled={verificationStep === "code"}
                          maxLength={10}
                      />
                    </div>
                  )}
                  {verificationStep === "code" && (
                    <>
                      <input
                        id="verificationCode"
                        name="verificationCode"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                        pattern="[0-9]{6}"
                        maxLength={6}
                        className="auth-input"
                        placeholder={t.auth.codePlaceholder}
                        value={formData.verificationCode}
                        onChange={handleChange}
                      />
                      <button type="button" className="code-resend" onClick={() => setIsResending(true)}>
                        {isResending ? t.auth.resendWait : t.auth.resendCode}
                      </button>
                    </>
                  )}
                </>
              ) : (
                <>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="auth-input"
                placeholder={t.auth.emailPlaceholder}
                value={formData.email}
                onChange={handleChange}
              />
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    className="auth-input"
                    placeholder={t.auth.passwordPlaceholder}
                    value={formData.password}
                    onChange={handleChange}
                  />
                </>
              )}
            </div>

            {authMode === "signin" && (
              <a href="/forgot-password" className="auth-link auth-link--right">{t.reset.forgotLink}</a>
            )}

            <button type="submit" disabled={isLoading} className="auth-submit">
              {isLoading ? t.auth.pleaseWait : authMode === "signup"
                ? verificationStep === "identifier" ? t.auth.sendCode : t.auth.verifyAndContinue
                : t.auth.signIn}
            </button>

          </form>
        </div>
      </section>
    </div>
  );
}
