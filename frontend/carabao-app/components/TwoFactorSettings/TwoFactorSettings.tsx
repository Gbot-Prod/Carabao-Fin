"use client";

import { useEffect, useState, type FormEvent } from "react";
import { disableTwoFactor, enableTwoFactor, getTwoFactorEnabled, verifyTwoFactorSetup } from "@/lib/auth-client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import styles from "./TwoFactorSettings.module.css";

type Step = "idle" | "password" | "setup" | "codes" | "disable";

/** The secret from an otpauth:// URI, for typing into an authenticator app. */
function secretFrom(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

/** Two-step verification (TOTP) for merchants and admins (E8a). */
export default function TwoFactorSettings() {
  const { t } = useLanguage();
  const s = t.twoFactor;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getTwoFactorEnabled().then(setEnabled).catch(() => setEnabled(false));
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : s.genericError);
    } finally {
      setBusy(false);
    }
  };

  const startEnable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await enableTwoFactor(password);
      setPassword("");
      setTotpUri(result.totpURI);
      setBackupCodes(result.backupCodes);
      setStep("setup");
    });
  };

  const confirmSetup = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await verifyTwoFactorSetup(code.trim());
      setCode("");
      setEnabled(true);
      setStep("codes");
    });
  };

  const confirmDisable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await disableTwoFactor(password);
      setPassword("");
      setEnabled(false);
      setStep("idle");
    });
  };

  const cancel = () => {
    setStep("idle");
    setPassword("");
    setCode("");
    setError("");
  };

  if (enabled === null) return null;
  const secret = secretFrom(totpUri);

  return (
    <section className={styles.card} aria-labelledby="two-factor-title">
      <div className={styles.header}>
        <h3 id="two-factor-title">{s.title}</h3>
        <span className={enabled ? styles.on : styles.off}>{enabled ? s.on : s.off}</span>
      </div>
      <p className={styles.body}>{s.intro}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}

      {step === "idle" && (
        <button
          type="button"
          className={enabled ? styles.secondary : styles.primary}
          onClick={() => setStep(enabled ? "disable" : "password")}
        >
          {enabled ? s.turnOff : s.turnOn}
        </button>
      )}

      {(step === "password" || step === "disable") && (
        <form className={styles.form} onSubmit={step === "password" ? startEnable : confirmDisable}>
          <label className={styles.label}>
            {s.passwordLabel}
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={busy}>
              {step === "password" ? s.continue : s.turnOff}
            </button>
            <button type="button" className={styles.secondary} onClick={cancel}>{s.cancel}</button>
          </div>
        </form>
      )}

      {step === "setup" && (
        <form className={styles.form} onSubmit={confirmSetup}>
          <p className={styles.body}>{s.setupHelp}</p>
          <p className={styles.keyLabel}>{s.setupKey}</p>
          <code className={styles.key}>{secret.replace(/(.{4})/g, "$1 ").trim()}</code>
          <a className={styles.link} href={totpUri}>{s.openApp}</a>
          <label className={styles.label}>
            {s.codeLabel}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={busy}>{s.confirm}</button>
            <button type="button" className={styles.secondary} onClick={cancel}>{s.cancel}</button>
          </div>
        </form>
      )}

      {step === "codes" && (
        <div className={styles.form}>
          <p className={styles.body}>{s.backupHelp}</p>
          <ul className={styles.codes}>
            {backupCodes.map((c) => <li key={c}><code>{c}</code></li>)}
          </ul>
          <button type="button" className={styles.primary} onClick={() => { setBackupCodes([]); setStep("idle"); }}>
            {s.savedCodes}
          </button>
        </div>
      )}
    </section>
  );
}
