"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { MerchantApplication } from "@/util/api/admin";
import styles from "./page.module.css";

// The DA RSBSA Finder. It refuses to load in a frame (X-Frame-Options: DENY)
// and has a captcha, so the admin opens it in a new tab and types the values.
const FINDER_URL = "https://finder-rsbsa.da.gov.ph/";

/** YYYY-MM-DD as MM/DD/YYYY. */
const finderDate = (iso: string | null) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : null;
};

/** Labeled box of copyable applicant fields alongside the DA RSBSA Finder link. */
export default function RsbsaFinder({ app }: { app: MerchantApplication }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!app.rsbsa_number && !app.rsbsa_document_original_name) return null;

  const fields = [
    { label: "First Name", value: app.first_name },
    { label: "Middle Name", value: app.middle_name },
    { label: "Last Name", value: app.last_name },
    { label: "Extension", value: app.suffix },
    { label: "Sex", value: app.sex },
    // The finder's date picker shows MM/DD/YYYY.
    { label: "Birthday", value: finderDate(app.birth_date) },
  ].filter((f): f is { label: string; value: string } => Boolean(f.value?.trim()));

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className={styles.rsbsaFinderBox}>
      <div className={styles.rsbsaFinderHeader}>
        <div>
          <span className={styles.rsbsaFinderTitle}>Extracted / Finder Data</span>
          <span className={styles.rsbsaFinderHint}>Click any field to copy for the DA RSBSA Finder</span>
        </div>
        <a className={styles.finderBtn} href={FINDER_URL} target="_blank" rel="noopener noreferrer">
          <span>Open DA RSBSA Finder</span>
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>

      {fields.length > 0 && (
        <div className={styles.rsbsaFinderFields}>
          {fields.map(({ label, value }) => {
            const upper = value.trim().toUpperCase();
            const isCopied = copied === label;
            return (
              <button
                key={label}
                type="button"
                className={`${styles.rsbsaFinderChip} ${isCopied ? styles.rsbsaFinderChipCopied : ""}`}
                onClick={() => void copy(label, upper)}
                title={`Copy ${label.toLowerCase()}`}
              >
                <span className={styles.fieldLabel}>{label}</span>
                <span className={styles.rsbsaFinderChipVal}>{upper}</span>
                {isCopied ? <Check size={12} aria-hidden="true" /> : <Copy size={11} className={styles.copyIcon} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}

      <p className={styles.rsbsaFinderNote}>
        {!app.sex || !app.birth_date
          ? "Sex and birthday are not in this application — read them from the government ID. "
          : ""}
        Compare the RSBSA No. on the finder card with{" "}
        {app.rsbsa_number ? <strong>{app.rsbsa_number}</strong> : "the RSBSA document"}.
      </p>
    </div>
  );
}
