"use client";

import { useState, type FormEvent } from "react";
import styles from "../page.module.css";
import getApiErrorMessage from "@/util/errorHelper";
import { pauseMyStore, resumeMyStore, type Merchant } from "@/util/api/merchants";
import { MAX_PAUSE_DAYS, activePause, addDays, manilaToday, pauseDateError, shortDay } from "@/lib/store-pause";

type Props = {
  merchant: Merchant | null;
  onSaved: (merchant: Merchant) => void;
};

/** CF-0066 (B13): stop taking orders for a while; the shop stays visible. */
export default function HolidayModePanel({ merchant, onSaved }: Props) {
  const today = manilaToday();
  const [until, setUntil] = useState(() => addDays(today, 7));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!merchant) return null;
  const pausedThrough = activePause(merchant.paused_until, today);

  const pause = async (e: FormEvent) => {
    e.preventDefault();
    const problem = pauseDateError(until, today);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await pauseMyStore(until, message.trim() || null));
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not pause your store.");
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await resumeMyStore());
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not resume your store.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="holiday-mode-title">
      <h2 className={styles.panelTitle} id="holiday-mode-title">Holiday mode</h2>
      {pausedThrough ? (
        <>
          <p>
            <strong>Your store is on a break through {shortDay(pausedThrough)}.</strong> Buyers can see your shop
            but cannot order. Orders open again by themselves the day after.
          </p>
          {merchant.pause_message && <p className={styles.kpiSub}>Message to buyers: “{merchant.pause_message}”</p>}
          <button type="button" className={styles.primaryBtn} onClick={() => void resume()} disabled={busy}>
            {busy ? "Saving…" : "Take orders again now"}
          </button>
        </>
      ) : (
        <form onSubmit={pause} style={{ display: "grid", gap: "0.6rem", maxWidth: "28rem" }}>
          <p className={styles.kpiSub}>
            Going away or between harvests? Pause orders up to {MAX_PAUSE_DAYS} days. Your listings stay visible, and
            orders already placed are not changed.
          </p>
          <label htmlFor="holiday-until" style={{ display: "grid", gap: "0.25rem" }}>
            <span>Last day of the break</span>
            <input
              id="holiday-until"
              type="date"
              value={until}
              min={today}
              max={addDays(today, MAX_PAUSE_DAYS)}
              onChange={(e) => setUntil(e.target.value)}
              required
            />
          </label>
          <label htmlFor="holiday-message" style={{ display: "grid", gap: "0.25rem" }}>
            <span>Message to buyers (optional)</span>
            <input
              id="holiday-message"
              value={message}
              maxLength={200}
              placeholder="Back after the harvest festival"
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <div>
            <button type="submit" className={styles.secondaryBtn} disabled={busy}>
              {busy ? "Saving…" : "Pause orders"}
            </button>
          </div>
        </form>
      )}
      {error && <p className={styles.danger} role="alert">{error}</p>}
    </section>
  );
}
