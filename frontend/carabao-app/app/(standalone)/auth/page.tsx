"use client";

import { signIn, signUp } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Logo from "@/public/images/icons/carabaoLogo.png";
import "./page.css";

export default function SignupPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    firstname: "",
    lastName: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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

    if (mode === "signup" && formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    try {
      if (mode === "signup") {
        await signUp.email({
          email: formData.email,
          password: formData.password,
          name: `${formData.firstname} ${formData.lastName}`.trim(),
        });
        router.push(`/verify-email?email=${encodeURIComponent(formData.email)}`);
      } else {
        await signIn.email({
          email: formData.email,
          password: formData.password,
        });
        router.push("/order");
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
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-shell">
          <div className="auth-header">
            <p className="auth-kicker">Welcome</p>
            <h2>{mode === "signup" ? "Create your Carabao account" : "Sign in to Carabao"}</h2>
            <div className="auth-switch" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                className={`auth-switch-btn ${mode === "signin" ? "active" : ""}`}
                onClick={() => setMode("signin")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`auth-switch-btn ${mode === "signup" ? "active" : ""}`}
                onClick={() => setMode("signup")}
              >
                Sign up
              </button>
            </div>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {error && (
              <div className="auth-error" role="alert" aria-live="polite">
                <div>{error}</div>
              </div>
            )}

            <div className="auth-fields">
              {mode === "signup" && (
                <div className="auth-name-row">
                  <input
                    id="firstname"
                    name="firstname"
                    type="text"
                    required
                    className="auth-input"
                    placeholder="First name"
                    value={formData.firstname}
                    onChange={handleChange}
                  />
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    required
                    className="auth-input"
                    placeholder="Last name"
                    value={formData.lastName}
                    onChange={handleChange}
                  />
                </div>
              )}

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

              {mode === "signup" && (
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  className="auth-input"
                  placeholder="Confirm password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                />
              )}
            </div>

            <button type="submit" disabled={isLoading} className="auth-submit">
              {isLoading ? "Please wait..." : mode === "signup" ? "Sign up" : "Sign in"}
            </button>

          </form>
        </div>
      </section>
    </div>
  );
}
