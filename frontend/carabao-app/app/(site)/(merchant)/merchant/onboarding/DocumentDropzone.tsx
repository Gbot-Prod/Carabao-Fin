"use client";

import { useState } from "react";
import styles from "./page.module.css";

export const DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** An error message for a document that the backend would refuse, or null. */
export function documentError(file: File | null, label: string): string | null {
  if (!file) return `Please upload your ${label} (photo or PDF).`;
  if (!DOCUMENT_TYPES.includes(file.type)) return `${label} must be a PDF or an image (PNG/JPG/WEBP).`;
  if (file.size > DOCUMENT_MAX_BYTES) return `${label} must be 10MB or smaller.`;
  return null;
}

type Props = {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
};

/** One drag-and-drop or click-to-browse upload for a PDF or image document. */
export default function DocumentDropzone({ label, file, onChange }: Props) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`${styles.dropzone} ${dragOver ? styles.dropzoneDragOver : ""} ${file ? styles.dropzoneWithFile : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onChange(dropped);
      }}
    >
      {file ? (
        <div className={styles.fileCard}>
          <span className={styles.fileCardIcon}>
            {file.type === "application/pdf" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="15" y2="17" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            )}
          </span>
          <div className={styles.fileCardInfo}>
            <span className={styles.fileCardName}>{file.name}</span>
            <span className={styles.fileCardMeta}>
              {file.type === "application/pdf" ? "PDF" : file.type.split("/")[1]?.toUpperCase()} ·{" "}
              {(file.size / 1024).toFixed(0)} KB
            </span>
          </div>
          <button
            type="button"
            className={styles.fileCardRemove}
            onClick={() => onChange(null)}
            aria-label={`Remove ${label}`}
          >
            ×
          </button>
        </div>
      ) : (
        <label className={styles.dropzoneLabel}>
          <input
            type="file"
            accept="image/*,application/pdf"
            hidden
            aria-label={label}
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
          <svg className={styles.dropzoneIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16" />
            <line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
          <span className={styles.dropzoneTitle}>Drop your file here</span>
          <span className={styles.dropzoneSubtitle}>or click to browse</span>
          <span className={styles.dropzoneMeta}>PDF · PNG · JPG · WEBP · max 10 MB</span>
        </label>
      )}
    </div>
  );
}
