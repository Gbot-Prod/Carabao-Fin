"use client";

import { useState } from "react";
import getApiErrorMessage, { getApiErrorStatus } from "@/util/errorHelper";
import { downloadMyData } from "@/util/api/users";
import styles from "./DataExportSection.module.css";

/** CF-0069 (B18): a copy of the account's own data, as one JSON file. */
export default function DataExportSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadMyData();
    } catch (err) {
      // The body of a failed blob request is a Blob, so the API's text is lost.
      setError(
        getApiErrorStatus(err) === 429
          ? "You can download your data 5 times an hour. Try again later."
          : (getApiErrorMessage(err) ?? "Could not prepare your data. Try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="data-export-title">
      <header className={styles.head}>
        <h3 className={styles.title} id="data-export-title">Your data</h3>
        <p className={styles.desc}>A copy of what Carabao keeps about you.</p>
      </header>
      <div className={styles.row}>
        <p className={styles.text}>
          Your account, saved addresses, orders and payments, reviews, followed farms, saved produce, the messages
          you sent, and your farm profile if you sell. It is a JSON file that other apps can read.
        </p>
        <button type="button" className={styles.button} onClick={() => void download()} disabled={busy}>
          {busy ? "Preparing…" : "Download my data"}
        </button>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>
  );
}
