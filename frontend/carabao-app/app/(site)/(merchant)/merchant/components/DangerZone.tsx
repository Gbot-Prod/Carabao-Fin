import { useState } from "react";
import { appUrl } from "@/lib/urls";
import styles from "../page.module.css";
import { deleteMyMerchant } from "@/util/api";
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

function readDeleteError(err: unknown): DeleteError {
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
  return {
    message: getApiErrorDetail(err) ?? "Couldn't delete your merchant profile. Please try again.",
    items: [],
  };
}

export default function DangerZone() {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<DeleteError | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteMyMerchant();
      window.location.assign(appUrl("/profile"));
    } catch (err) {
      setDeleting(false);
      setError(readDeleteError(err));
    }
  };

  const cancel = () => {
    setConfirming(false);
    setError(null);
  };

  return (
    <div className={styles.dangerZone}>
      <h3 className={styles.dangerTitle}>Danger Zone</h3>
      {!confirming ? (
        <button className={styles.dangerBtn} onClick={() => setConfirming(true)}>Delete merchant profile</button>
      ) : (
        <div className={styles.dangerConfirm}>
          <p className={styles.dangerWarning}>This will permanently delete your merchant profile, shop page, and all listed produce. Your order history will be preserved. This cannot be undone.</p>
          <div className={styles.dangerActions}>
            <button className={styles.dangerConfirmBtn} disabled={deleting} onClick={() => void handleDelete()} aria-describedby={error ? "delete-merchant-error" : undefined}>{deleting ? "Deleting…" : "Yes, delete my merchant profile"}</button>
            <button className={styles.secondaryBtn} disabled={deleting} onClick={cancel}>Cancel</button>
          </div>
          {error && (
            <div id="delete-merchant-error" role="alert" className={styles.dangerError}>
              <p>{error.items.length > 0 ? `${error.message.replace(/\.$/, "")}:` : error.message}</p>
              {error.items.length > 0 && (
                <ul>
                  {error.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
