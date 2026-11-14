"use client";

import { useState, type FormEvent } from "react";
import { sendPhoneCode, verifyMyPhone } from "@/lib/auth-client";
import { formatPhMobile, normalizePhMobile } from "@/lib/phone";
import styles from "./PhoneVerifyDialog.module.css";

type Props = {
  /** Why we're asking, e.g. "Checkout needs a verified mobile number." */
  reason?: string;
  initialNumber?: string | null;
  onClose: () => void;
  /** Called once the number is verified and saved to the account. */
  onVerified: (phoneNumber: string) => void;
};

/**
 * Adds or changes the account's mobile number: we text a code, and entering it
 * saves the number as verified (BetterAuth phoneNumber plugin). Checkout,
 * merchant applications and order chat need one (backend PHONE_VERIFICATION_REQUIRED).
 */
export default function PhoneVerifyDialog({ reason, initialNumber, onClose, onVerified }: Props) {
  const [phone, setPhone] = useState(initialNumber ? formatPhMobile(initialNumber) : "");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!codeSent) {
        await sendPhoneCode(phone);
        setCodeSent(true);
      } else {
        await verifyMyPhone(phone, code);
        onVerified(normalizePhMobile(phone) ?? phone);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className={styles.card} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="phone-verify-title">
        <h3 id="phone-verify-title" className={styles.title}>Verify your mobile number</h3>
        <p className={styles.body}>
          {reason ?? "We'll text you a 6-digit code."}
        </p>
        <label className={styles.label} htmlFor="phone-verify-number">Mobile number</label>
        <input
          id="phone-verify-number"
          className={styles.input}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0912 345 6789"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={codeSent || busy}
          required
        />
        {codeSent && (
          <>
            <label className={styles.label} htmlFor="phone-verify-code">Code</label>
            <input
              id="phone-verify-code"
              className={styles.input}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
            />
            <button type="button" className={styles.link} onClick={() => { setCodeSent(false); setCode(""); }} disabled={busy}>
              Use a different number
            </button>
          </>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? "Please wait…" : codeSent ? "Verify" : "Text me a code"}
          </button>
          <button type="button" className={styles.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
