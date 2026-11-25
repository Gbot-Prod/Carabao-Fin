"use client";

import { useState } from "react";
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

/** A link to the DA RSBSA Finder with the applicant's name parts to copy. */
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
    <div className={styles.rsbsaFinder}>
      <a className={styles.docLink} href={FINDER_URL} target="_blank" rel="noopener noreferrer">
        Open DA RSBSA Finder ↗
      </a>
      {fields.length > 0 && (
        <div className={styles.rsbsaFinderFields}>
          {fields.map(({ label, value }) => {
            const upper = value.trim().toUpperCase();
            return (
              <button
                key={label}
                type="button"
                className={styles.rsbsaFinderChip}
                onClick={() => void copy(label, upper)}
                title={`Copy ${label.toLowerCase()}`}
              >
                <span className={styles.fieldLabel}>{label}</span> {upper}
                {copied === label ? " ✓" : ""}
              </button>
            );
          })}
        </div>
      )}
      <span className={styles.documentName}>
        {!app.sex || !app.birth_date ? "Sex and birthday are not in this application: read them from the government ID. " : ""}
        Compare the RSBSA No. on the finder card with {app.rsbsa_number ? <strong>{app.rsbsa_number}</strong> : "the RSBSA document"}.
      </span>
    </div>
  );
}
