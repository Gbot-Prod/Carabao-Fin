"use client";

import { useState, type FormEvent } from "react";
import styles from "../page.module.css";
import c from "./ShopSettings.module.css";
import getApiErrorMessage from "@/util/errorHelper";
import FieldError, { invalidClass, invalidProps } from "@/components/FieldError/FieldError";
import { pauseMyStore, resumeMyStore, type Merchant } from "@/util/api/merchants";
import { MAX_PAUSE_DAYS, activePause, addDays, manilaToday, pauseDateError, shortDay } from "@/lib/store-pause";

type Props = {
  merchant: Merchant | null;
  onSaved: (merchant: Merchant) => void;
};

/** CF-0066 (B13), "Shop close mode": stop taking orders for a while; the shop stays visible. */
export default function HolidayModePanel({ merchant, onSaved }: Props) {
  const today = manilaToday();
  const [until, setUntil] = useState(() => addDays(today, 7));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!merchant) return null;
  const pausedThrough = activePause(merchant.paused_until, today);

  const pause = async (e: FormEvent) => {
    e.preventDefault();
    const problem = pauseDateError(until, today);
    if (problem) {
      setDateError(problem);
      document.getElementById("holiday-until")?.focus();
      return;
    }
    setBusy(true);
    setDateError(null);
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
    <section className={c.section} aria-labelledby="shop-close-title">
      <div className={c.sectionHead}>
        <h2 className={c.sectionTitle} id="shop-close-title">Shop close mode</h2>
        <span className={`${c.pill} ${pausedThrough ? c.pillPaused : c.pillOn}`}>
          {pausedThrough ? `Closed through ${shortDay(pausedThrough)}` : "Open for orders"}
        </span>
      </div>
      {pausedThrough ? (
        <div className={c.fields}>
          <p className={c.line}>
            <strong>Your shop is closed through {shortDay(pausedThrough)}.</strong>
          </p>
          <p className={c.muted}>Buyers can see your shop but cannot order. Orders open again by themselves the day after.</p>
          {merchant.pause_message && (
            <div className={c.group}>
              <p className={c.groupTitle}>Message to buyers</p>
              <p className={c.line}>“{merchant.pause_message}”</p>
            </div>
          )}
          {error && <p className={styles.errorText} role="alert">{error}</p>}
          <div className={c.actions}>
            <button type="button" className={styles.primaryBtn} onClick={() => void resume()} disabled={busy}>
              {busy ? "Saving…" : "Take orders again now"}
            </button>
          </div>
        </div>
      ) : (
        <form className={c.fields} onSubmit={pause} noValidate>
          <p className={c.muted}>
            Going away or between harvests? Pause orders up to {MAX_PAUSE_DAYS} days. Your listings stay visible, and
            orders already placed are not changed.
          </p>
          <label className={`${styles.formLabel}${invalidClass(dateError)}`} htmlFor="holiday-until">
            Last day closed
            <input
              id="holiday-until"
              className={styles.formInput}
              type="date"
              value={until}
              min={today}
              max={addDays(today, MAX_PAUSE_DAYS)}
              onChange={(e) => { setUntil(e.target.value); setDateError(null); }}
              {...invalidProps("holiday-until", dateError)}
            />
            <FieldError id="holiday-until" message={dateError} />
          </label>
          <label className={styles.formLabel} htmlFor="holiday-message">
            Message to buyers (optional)
            <input
              id="holiday-message"
              className={styles.formInput}
              value={message}
              maxLength={200}
              placeholder="Back until next harvest"
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          {error && <p className={styles.errorText} role="alert">{error}</p>}
          <div className={c.actions}>
            <button type="submit" className={styles.secondaryBtn} disabled={busy}>
              {busy ? "Saving…" : "Pause orders"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
