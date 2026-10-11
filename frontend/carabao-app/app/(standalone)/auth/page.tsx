"use client";

import { signIn } from "@/lib/auth-client";
import { apiClient } from "@/util/api";
import { Mail, Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Logo from "@/public/images/icons/carabaoLogo.png";
import "./page.css";

export default function SignupPage() {
  const router = useRouter();
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
  const [verificationStep, setVerificationStep] = useState<"identifier" | "code">("identifier");

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
        await signIn.email({
          email: formData.email,
          password: formData.password,
        });
        router.push("/");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand-content">
          <img src={Logo.src} alt="Carabao Logo" className="auth-brand-logo" />
          <h1>Carabao</h1>
          <p>
            Farm-fresh produce, delivered with confidence. Join the marketplace that connects
            buyers and trusted local merchants.
          </p>
        </div>
        <div className="auth-brand-orb auth-brand-orb-one" aria-hidden="true" />
        <div className="auth-brand-orb auth-brand-orb-three" aria-hidden="true" />
        <div className="auth-brand-orb auth-brand-orb-two" aria-hidden="true" />
        <div className="auth-brand-orb auth-brand-orb-four" aria-hidden="true" />
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-shell">
          <div className="auth-header">
            <p className="auth-kicker">Welcome</p>
            <h2>{authMode === "signup" ? "Create your Carabao account" : "Sign in to Carabao"}</h2>
            <div className="auth-header-buttons">
              <div className="auth-switch" role="tablist" aria-label="Authentication mode">
                <button
                  type="button"
                  className={`auth-switch-btn ${authMode === "signin" ? "active" : ""}`}
                  onClick={() => { setMode("signin"); setVerificationStep("identifier"); setError(""); }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={`auth-switch-btn ${authMode === "signup" ? "active" : ""}`}
                  onClick={() => { setMode("signup"); setVerificationStep("identifier"); setError(""); }}
                >
                  Sign up
                </button>
              </div>

              {authMode === "signup" && (
                <div
                  className="signup-mode-switch"
                  role="tablist"
                  aria-label="Signup mode"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-label="Sign up with phone number"
                    aria-selected={signUpMode === "number"}
                    title="Sign up with phone number"
                    className={`signup-mode-btn ${signUpMode === "number" ? "active" : ""
                      }`}
                    onClick={() => setSignUpMode("number")}
                  >
                    <Phone aria-hidden="true" size={18} />
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-label="Sign up with email"
                    aria-selected={signUpMode === "email"}
                    title="Sign up with email"
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
            {error && (
              <div className="auth-error" role="alert" aria-live="polite">
                <div>{error}</div>
              </div>
            )}

            <div className="auth-fields">
              {authMode === "signup" ? (
                <>
                  <input
                    id={signUpMode === "email" ? "email" : "phoneNumber"}
                    name={signUpMode === "email" ? "email" : "phoneNumber"}
                    type={signUpMode === "email" ? "email" : "tel"}
                    autoComplete={signUpMode === "email" ? "email" : "tel"}
                    required
                    className="auth-input"
                    placeholder={signUpMode === "email" ? "Email address" : "+63 912 345 6789"}
                    value={signUpMode === "email" ? formData.email : formData.phoneNumber}
                    onChange={handleChange}
                    disabled={verificationStep === "code"}
                  />
                  {verificationStep === "code" && (
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
                      placeholder="6-digit verification code"
                      value={formData.verificationCode}
                      onChange={handleChange}
                    />
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
                placeholder="Email address"
                value={formData.email}
                onChange={handleChange}
              />
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    className="auth-input"
                    placeholder="Password"
                    value={formData.password}
                    onChange={handleChange}
                  />
                </>
              )}
            </div>

            <button type="submit" disabled={isLoading} className="auth-submit">
              {isLoading ? "Please wait..." : authMode === "signup"
                ? verificationStep === "identifier" ? "Send verification code" : "Verify and continue"
                : "Sign in"}
            </button>

          </form>
        </div>
      </section>
    </div>
  );
}
