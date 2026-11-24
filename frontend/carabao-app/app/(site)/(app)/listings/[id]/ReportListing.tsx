"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAuthPrompt } from "@/components/AuthPrompt/AuthPromptContext";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import getApiErrorMessage from "@/util/errorHelper";
import { LISTING_REPORT_REASONS, reportListing, type ListingReportReason } from "@/util/api/produce";
import styles from "./page.module.css";

const NOTE_MIN = 10;
const NOTE_MAX = 500;

/** Guardrails Phase 3: a buyer reports a listing; it goes to the admin queue. */
export default function ReportListing({ produceId }: { produceId: number }) {
  const { isAuthenticated } = useAuth();
  const { showPrompt } = useAuthPrompt();
  const { t } = useLanguage();
  const s = t.listingPage.report;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ListingReportReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p className={styles.reportDone} role="status">
        {s.sent}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className={styles.reportLink}
        onClick={() => (isAuthenticated ? setOpen(true) : showPrompt())}
      >
        {s.open}
      </button>
    );
  }

  const noteNeeded = reason === "OTHER" && note.trim().length < NOTE_MIN;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason || noteNeeded) return;
    setBusy(true);
    setError(null);
    try {
      await reportListing(produceId, { reason, note: note.trim() || null });
      setSent(true);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? s.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.reportForm} onSubmit={submit} aria-labelledby="report-title">
      <h2 id="report-title" className={styles.reportTitle}>
        {s.title}
      </h2>
      <label className={styles.reportField}>
        <span>{s.reason}</span>
        <select value={reason} onChange={(e) => setReason(e.target.value as ListingReportReason)} required>
          <option value="" disabled>
            {s.choose}
          </option>
          {LISTING_REPORT_REASONS.map((code) => (
            <option key={code} value={code}>
              {s.reasons[code]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.reportField}>
        <span>{reason === "OTHER" ? s.noteRequired : s.note}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} rows={3} />
      </label>
      {error && (
        <p className={styles.reportError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.reportActions}>
        <button type="submit" className={styles.primary} disabled={busy || !reason || noteNeeded}>
          {busy ? s.sending : s.send}
        </button>
        <button type="button" className={styles.secondary} onClick={() => setOpen(false)} disabled={busy}>
          {s.cancel}
        </button>
      </div>
    </form>
  );
}
