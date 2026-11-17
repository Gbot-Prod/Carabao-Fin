"use client";

import { useEffect, useState } from "react";
import errorHelper from "@/util/errorHelper";
import { formatCountdown, useResendCooldown } from "@/hooks/useResendCooldown";
import styles from "./page.module.css";

type Props = {
  /** What the code goes to, e.g. "email" or "number"; used in the hints. */
  channel: string;
  /** The value being verified. A new value clears a sent code. */
  value: string;
  /** True when the value is proven (the account's own, or a code was entered). */
  verified: boolean;
  /** Shown when verified without a code (the account's own value). */
  accountNote?: string;
  disabled?: boolean;
  /** Returns an error message to show instead of sending, or null to send. */
  validate: () => string | null;
  onSend: () => Promise<void>;
  onVerify: (code: string) => Promise<void>;
};

/** Send / enter / verify a 6-digit code for one contact value (email or SMS). */
export default function ContactCodeField({
  channel,
  value,
  verified,
  accountNote,
  disabled,
  validate,
  onSend,
  onVerify,
}: Props) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  // Site-wide: a minute between codes to one value, counted down on the page.
  const resendTimer = useResendCooldown();
  const cooldown = resendTimer.secondsLeft(value);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A different value makes a sent code not applicable.
  useEffect(() => {
    setSent(false);
    setCode("");
    setError(null);
  }, [value]);

  const send = async () => {
    setError(null);
    const invalid = validate();
    if (invalid) return setError(invalid);
    setSending(true);
    try {
      await onSend();
      setSent(true);
      setCode("");
      resendTimer.start(value);
    } catch (e: unknown) {
      resendTimer.startFromError(value, e);
      setError(errorHelper(e) || "Failed to send the code. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    setError(null);
    setVerifying(true);
    try {
      await onVerify(code);
      setSent(false);
      setCode("");
    } catch (e: unknown) {
      setError(errorHelper(e) || "Incorrect code. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  if (verified) {
    return (
      <p className={styles.verifiedNote} role="status">
        <span aria-hidden="true">✓</span> {accountNote ?? `Your ${channel} is verified.`}
      </p>
    );
  }

  return (
    <div className={styles.codeRow}>
      {!sent ? (
        <button
          type="button"
          className={styles.resendBtn}
          onClick={send}
          disabled={disabled || sending || !value.trim()}
        >
          {sending ? "Sending…" : "Send verification code"}
        </button>
      ) : (
        <>
          <p className={styles.otpHint}>Enter the 6-digit code sent to your {channel}.</p>
          <div className={styles.codeInputs}>
            <input
              className={styles.codeInput}
              aria-label={`6-digit code sent to your ${channel}`}
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="––––––"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoComplete="one-time-code"
              disabled={disabled || verifying}
            />
            <button
              type="button"
              className={styles.verifyBtn}
              onClick={verify}
              disabled={disabled || verifying || code.length < 6}
            >
              {verifying ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              className={styles.resendBtn}
              onClick={send}
              disabled={disabled || cooldown > 0 || sending}
              aria-live="polite"
            >
              {cooldown > 0 ? `Resend in ${formatCountdown(cooldown)}` : "Resend"}
            </button>
          </div>
        </>
      )}
      {error && <div className={styles.errorBox}>{error}</div>}
    </div>
  );
}
