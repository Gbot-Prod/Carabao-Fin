"use client";

import { useState } from "react";
import { reinstateUser, suspendUser } from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import styles from "./suspend.module.css";

type Props = {
  userId: number;
  suspended: boolean | null | undefined;
  reason: string | null | undefined;
  /** What gets hidden, for the confirmation text. */
  isMerchant?: boolean;
  disabled?: boolean;
  onChange: (suspended: boolean, reason: string | null) => void;
};

/** Suspend (with a reason) or reinstate an account (A3). */
export default function SuspendControl({ userId, suspended, reason, isMerchant, disabled, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suspend = async () => {
    const effect = isMerchant
      ? "They won't be able to sign in, and their shop and listings will be hidden from buyers."
      : "They won't be able to sign in.";
    const entered = window.prompt(`Suspend this account? ${effect}\n\nReason (shown to the user):`);
    if (entered === null) return;
    if (!entered.trim()) {
      setError("A reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await suspendUser(userId, entered.trim());
      onChange(Boolean(user.is_suspended), user.suspension_reason ?? null);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not suspend.");
    } finally {
      setBusy(false);
    }
  };

  const reinstate = async () => {
    if (!window.confirm("Reinstate this account?")) return;
    setBusy(true);
    setError(null);
    try {
      await reinstateUser(userId);
      onChange(false, null);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not reinstate.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      {suspended ? (
        <>
          <span className={styles.suspended} title={reason ?? undefined}>Suspended</span>
          <button type="button" className={styles.action} onClick={() => void reinstate()} disabled={busy || disabled}>
            Reinstate
          </button>
        </>
      ) : (
        <>
          <span className={styles.active}>Active</span>
          <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => void suspend()} disabled={busy || disabled}>
            Suspend
          </button>
        </>
      )}
      {suspended && reason && <span className={styles.reason}>{reason}</span>}
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
