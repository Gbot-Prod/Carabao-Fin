"use client";

import { useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { enableTwoFactor, getTwoFactorEnabled, verifyTwoFactorSetup } from "@/lib/auth-client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import styles from "./TwoFactorSettings.module.css";

type Step = "idle" | "setup" | "codes";

/** The secret from an otpauth:// URI, for typing into an authenticator app. */
function secretFrom(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

/**
 * Two-step verification (TOTP) for admins (E8a).
 *
 * Setup needs the one-time token from the link that an admin action sends
 * (CF-0018), so this only offers "Turn on" when `enrolmentToken` is given
 * (the /two-factor/enrol page). Admins cannot turn it off; another admin
 * resets it.
 */
export default function TwoFactorSettings({
  enrolmentToken,
  needsPassword = false,
  onDone,
}: {
  enrolmentToken?: string;
  /** The account has a password, so setup asks for it too. */
  needsPassword?: boolean;
  /** Called when the admin has saved the backup codes after setup. */
  onDone?: () => void;
}) {
  const { t } = useLanguage();
  const s = t.twoFactor;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
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
    if (!enrolmentToken) return;
    void run(async () => {
      const result = await enableTwoFactor(enrolmentToken, needsPassword ? password : undefined);
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

  const cancel = () => {
    setStep("idle");
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

      {step === "idle" && enabled && <p className={styles.body}>{s.onHelp}</p>}

      {step === "idle" && !enabled && !enrolmentToken && <p className={styles.body}>{s.needLink}</p>}

      {step === "idle" && !enabled && enrolmentToken && (
        <form className={styles.form} onSubmit={startEnable}>
          {needsPassword && (
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
          )}
          <button type="submit" className={styles.primary} disabled={busy}>
            {s.turnOn}
          </button>
        </form>
      )}

      {step === "setup" && (
        <form className={styles.form} onSubmit={confirmSetup}>
          <p className={styles.body}>{s.setupHelp}</p>
          {/* Drawn here in the browser: the secret is never sent to a QR service. */}
          <div className={styles.qr}>
            <QRCodeSVG value={totpUri} size={176} marginSize={2} title={s.qrLabel} />
          </div>
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
          <button type="button" className={styles.primary} onClick={() => { setBackupCodes([]); setStep("idle"); onDone?.(); }}>
            {s.savedCodes}
          </button>
        </div>
      )}
    </section>
  );
}
