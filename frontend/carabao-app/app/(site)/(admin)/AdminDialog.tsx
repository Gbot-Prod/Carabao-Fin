"use client";

import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./adminDialog.module.css";

/**
 * A centred dialog over an admin page: forms and one-off panels that used to
 * sit above a table (invite an admin, add a word), so the table keeps the
 * whole page. Escape or the backdrop closes it unless `locked`.
 */
export default function AdminDialog({
  title,
  description,
  onClose,
  locked,
  children,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** No closing by Escape, backdrop or ×: the page must be acted on first. */
  locked?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, onClose]);

  return (
    <div className={styles.backdrop} onClick={locked ? undefined : onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {!locked && (
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
              <X size={16} strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}
        </div>
        {description && <div className={styles.description}>{description}</div>}
        {children}
      </div>
    </div>
  );
}
