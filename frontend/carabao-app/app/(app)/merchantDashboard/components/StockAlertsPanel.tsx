"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "../page.module.css";
import { formatDate } from "../lib/format";
import getApiErrorMessage from "@/util/errorHelper";
import {
  fetchMyStockAlerts,
  updateMyLowStockThreshold,
  type StockAlertItem,
  type StockAlerts,
} from "@/util/api";

type Props = {
  /** Re-fetch when the listings change (e.g. stock edited on the Produce tab). */
  refreshKey: unknown;
  onThreshold?: (threshold: number) => void;
};

const daysLabel = (d: number | null) =>
  d == null ? "" : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;

/** F1: low-stock and best-before alerts with the merchant's own threshold. */
export default function StockAlertsPanel({ refreshKey, onThreshold }: Props) {
  const [alerts, setAlerts] = useState<StockAlerts | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMyStockAlerts()
      .then((a) => {
        if (!live) return;
        setAlerts(a);
        setDraft(String(a.low_stock_threshold));
        onThreshold?.(a.low_stock_threshold);
      })
      .catch((err) => live && setError(getApiErrorMessage(err) ?? "Could not load stock alerts."));
    return () => {
      live = false;
    };
  }, [refreshKey, onThreshold]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(draft);
    if (!Number.isInteger(value) || value < 0) {
      setError("Enter a whole number, 0 or more.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const a = await updateMyLowStockThreshold(value);
      setAlerts(a);
      onThreshold?.(a.low_stock_threshold);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not save the threshold.");
    } finally {
      setSaving(false);
    }
  };

  if (!alerts) {
    return error ? <p className={styles.danger} role="alert">{error}</p> : null;
  }

  const list = (items: StockAlertItem[], render: (i: StockAlertItem) => string) => (
    <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem" }}>
      {items.map((i) => (
        <li key={i.id}>
          <strong>{i.name}</strong> — {render(i)}
        </li>
      ))}
    </ul>
  );
  const nothing = !alerts.low_stock.length && !alerts.expiring_soon.length && !alerts.expired.length;

  return (
    <section className={styles.panel} aria-labelledby="stock-alerts-title">
      <h2 className={styles.panelTitle} id="stock-alerts-title">Stock alerts</h2>

      <form onSubmit={save} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="low-stock-threshold">Flag listings with stock at or below</label>
        <input
          id="low-stock-threshold"
          type="number"
          min={0}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ width: "5rem" }}
        />
        <button type="submit" className={styles.secondaryBtn} disabled={saving || draft === String(alerts.low_stock_threshold)}>
          {saving ? "Saving…" : "Save"}
        </button>
        <span className={styles.kpiSub}>0 turns low-stock alerts off.</span>
      </form>
      {error && <p className={styles.danger} role="alert">{error}</p>}

      {nothing ? (
        <p className={styles.kpiSub}>No alerts. Every listing is stocked and within its best-before date.</p>
      ) : (
        <>
          {alerts.low_stock.length > 0 && (
            <div>
              <h3 className={`${styles.panelLabel} ${styles.warning}`}>Low stock ({alerts.low_stock.length})</h3>
              {list(alerts.low_stock, (i) => `${i.stock_quantity} ${i.unit} left`)}
            </div>
          )}
          {alerts.expiring_soon.length > 0 && (
            <div>
              <h3 className={`${styles.panelLabel} ${styles.warning}`}>
                Best-before within {alerts.expiry_warning_days} days ({alerts.expiring_soon.length})
              </h3>
              {list(alerts.expiring_soon, (i) => `best before ${formatDate(i.best_before)} (${daysLabel(i.days_left)})`)}
            </div>
          )}
          {alerts.expired.length > 0 && (
            <div>
              <h3 className={`${styles.panelLabel} ${styles.danger}`}>
                Expired — hidden from buyers ({alerts.expired.length})
              </h3>
              {list(alerts.expired, (i) => `best before ${formatDate(i.best_before)}; update the dates or remove it`)}
            </div>
          )}
        </>
      )}
    </section>
  );
}
