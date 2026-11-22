"use client";

import { use, useState, type FormEvent } from "react";
import { signIn } from "@/lib/auth-client";
import { safeNextPath } from "@/lib/next-path";
import "@/app/(site)/(standalone)/auth/page.css";

// admin.<root> sign-in: email + password only. An admin with two-step
// verification goes on to /two-factor (the client's onTwoFactorRedirect).
// The server gives a session only to admin accounts (lib/auth.ts
// adminSurfaceOnly) and blocks phone, Google and Facebook sign-in here.
export default function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  // An accepted admin invite sends the invitee here with their email.
  const { email: given } = use(searchParams);
  const [email, setEmail] = useState(typeof given === "string" ? given : "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await signIn.email({ email: email.trim(), password });
      if ("twoFactorRedirect" in result && result.twoFactorRedirect) return; // the client goes to /two-factor
      const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
      // Full load so every hook re-reads the new session.
      window.location.assign(next === "/" ? "/admin/dashboard" : next);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Sign-in failed. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="auth-page auth-page--single">
      <section className="auth-form-panel">
        <div className="auth-form-shell">
          <div className="auth-header">
            <div className="auth-kicker-row">
              <p className="auth-kicker">Carabao admin</p>
            </div>
            <h2>Sign in</h2>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <div className="auth-fields">
              {error && <div className="auth-error" role="alert">{error}</div>}
              <input
                className="auth-input"
                type="email"
                aria-label="Email"
                placeholder="Email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                className="auth-input"
                type="password"
                aria-label="Password"
                placeholder="Password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? "Please wait…" : "Sign in"}
            </button>
          </form>
          {/* No password reset for admins: the operator recovers the account
              (make_admin.py, documentation/manuals/Admin creation.md). */}
          <p className="auth-help">Forgot your password? Ask the Carabao operator to recover your account.</p>
        </div>
      </section>
    </div>
  );
}
