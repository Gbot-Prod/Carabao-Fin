import { useState, type FormEvent } from "react";
import { appUrl } from "@/lib/urls";
import styles from "../page.module.css";
import c from "./ShopSettings.module.css";
import { deleteMyMerchant, sendMerchantDeleteCode } from "@/util/api";
import { hasPassword } from "@/lib/auth-client";
import { formatCountdown, useResendCooldown } from "@/hooks/useResendCooldown";
import { getApiErrorDetail, getApiErrorStatus } from "@/util/errorHelper";

// The backend's 409 names what is still open (find_deletion_blockers).
const BLOCKER_LABELS: Record<string, (n: number) => string> = {
  active_orders: (n) => `${n} active order${n === 1 ? "" : "s"} to complete or cancel`,
  pending_payments: (n) => `${n} payment${n === 1 ? "" : "s"} still pending`,
  refunds_pending: (n) => `${n} refund${n === 1 ? "" : "s"} still being processed`,
  unpaid_earnings: (n) => `₱${n.toLocaleString("en-PH")} in earnings not yet paid out to you`,
  open_payouts: (n) => `${n} payout${n === 1 ? "" : "s"} still in progress`,
};

type DeleteError = { message: string; items: string[] };

function readDeleteError(err: unknown, fallback: string): DeleteError {
  const data = (err as { response?: { data?: { detail?: unknown } } })?.response?.data;
  const detail = data?.detail;
  if (getApiErrorStatus(err) === 409 && detail && typeof detail === "object") {
    const { message, blockers } = detail as { message?: unknown; blockers?: unknown };
    const items =
      blockers && typeof blockers === "object"
        ? Object.entries(blockers as Record<string, number>).map(([key, n]) =>
            BLOCKER_LABELS[key] ? BLOCKER_LABELS[key](n) : `${key.replace(/_/g, " ")}: ${n}`,
          )
        : [];
    return {
      message: typeof message === "string" ? message : "Your shop can't be deleted yet.",
      items,
    };
  }
  return { message: getApiErrorDetail(err) ?? fallback, items: [] };
}

// idle: the button. password: type the password (or, with no password, confirm).
// code: type the code texted to the verified mobile number. The backend checks
// both (POST /merchants/me/delete-code, then DELETE /merchants/me), the same
// steps as deleting the account, so a session alone cannot close the shop.
type Step = "idle" | "password" | "code";

// The resend timer's key: the code always goes to the account's own number.
const CODE_TARGET = "merchant-delete";

export default function DangerZone() {
  const [step, setStep] = useState<Step>("idle");
  // null until known; false for a Google/Facebook-only account.
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DeleteError | null>(null);
  // Site-wide: a minute between codes, counted down on the page.
  const resendTimer = useResendCooldown();
  const resendIn = resendTimer.secondsLeft(CODE_TARGET);

  const reset = () => {
    setStep("idle");
    setPassword("");
    setCode("");
    setError(null);
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setNeedsPassword(await hasPassword());
      setStep("password");
    } catch (err) {
      setError({ message: err instanceof Error && err.message ? err.message : "Something went wrong. Try again.", items: [] });
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      setSentTo(await sendMerchantDeleteCode(needsPassword ? password : undefined));
      setCode("");
      setStep("code");
      resendTimer.start(CODE_TARGET);
    } catch (err) {
      resendTimer.startFromError(CODE_TARGET, err);
      setError(readDeleteError(err, "We couldn't send the code. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await deleteMyMerchant(code.trim());
      window.location.assign(appUrl("/profile"));
    } catch (err) {
      setBusy(false);
      setError(readDeleteError(err, "Couldn't delete your merchant profile. Try again."));
    }
  };

  const errorBlock = error && (
    <div id="delete-merchant-error" role="alert" className={styles.dangerError}>
      <p>{error.items.length > 0 ? `${error.message.replace(/\.$/, "")}:` : error.message}</p>
      {error.items.length > 0 && (
        <ul>
          {error.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
    </div>
  );

  return (
    <section className={`${c.section} ${c.dangerSection}`} aria-labelledby="danger-zone-title">
      <h2 id="danger-zone-title" className={`${c.sectionTitle} ${c.dangerTitle}`}>Delete merchant profile</h2>
      {step === "idle" && (
        <>
          <div className={c.dangerRow}>
            <p className={c.muted}>
              Permanently remove your merchant profile, shop page and listed produce. Your order history is kept. You
              need your password and a code texted to your mobile number.
            </p>
            <button type="button" className={styles.dangerBtn} disabled={busy} onClick={() => void start()}>
              {busy ? "Loading…" : "Delete merchant profile"}
            </button>
          </div>
          {errorBlock}
        </>
      )}

      {step === "password" && (
        <form className={styles.dangerConfirm} onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
          <p className={styles.dangerWarning}>
            This permanently deletes your merchant profile, shop page, and all listed produce. Your order history is
            kept. You cannot undo it.{" "}
            {needsPassword
              ? "Type your current password. Then we send a code to your mobile number."
              : "We will send a code to your mobile number. Type it to delete your merchant profile."}
          </p>
          {needsPassword && (
            <label className={styles.formLabel} htmlFor="merchant-delete-password">
              Current password
              <input
                id="merchant-delete-password"
                type="password"
                className={styles.formInput}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
                {...(error ? { "aria-invalid": true, "aria-describedby": "delete-merchant-error" } : {})}
              />
            </label>
          )}
          {errorBlock}
          <div className={styles.dangerActions}>
            <button type="submit" className={styles.dangerConfirmBtn} disabled={busy || (!!needsPassword && !password)}>
              {busy ? "Sending…" : "Send code"}
            </button>
            <button type="button" className={styles.secondaryBtn} disabled={busy} onClick={reset}>Cancel</button>
          </div>
        </form>
      )}

      {step === "code" && (
        <form className={styles.dangerConfirm} onSubmit={(e) => void confirmDelete(e)}>
          <p className={styles.dangerWarning}>
            We sent a code to your number ending in {sentTo}. Type it to permanently delete your merchant profile.
          </p>
          <label className={styles.formLabel} htmlFor="merchant-delete-code">
            Code
            <input
              id="merchant-delete-code"
              className={styles.formInput}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              autoFocus
              required
              {...(error ? { "aria-invalid": true, "aria-describedby": "delete-merchant-error" } : {})}
            />
          </label>
          {errorBlock}
          <div className={styles.dangerActions}>
            <button type="submit" className={styles.dangerConfirmBtn} disabled={busy || code.length < 6}>
              {busy ? "Deleting…" : "Yes, delete my merchant profile"}
            </button>
            <button type="button" className={styles.linkBtn} disabled={busy || resendIn > 0} onClick={() => void sendCode()}>
              {resendIn > 0 ? `Send a new code in ${formatCountdown(resendIn)}` : "Send a new code"}
            </button>
            <button type="button" className={styles.secondaryBtn} disabled={busy} onClick={reset}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
