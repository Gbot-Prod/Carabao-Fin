import { useState } from "react";
import { appUrl } from "@/lib/urls";
import styles from "../page.module.css";
import { deleteMyMerchant } from "@/util/api";

export default function DangerZone() {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try { await deleteMyMerchant(); window.location.assign(appUrl("/profile")); }
    catch { setDeleting(false); setConfirming(false); }
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
            <button className={styles.dangerConfirmBtn} disabled={deleting} onClick={() => void handleDelete()}>{deleting ? "Deleting…" : "Yes, delete my merchant profile"}</button>
            <button className={styles.secondaryBtn} disabled={deleting} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
