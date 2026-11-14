"use client";

import styles from "./TermsModal.module.css";
import TermsOfServiceContent from "./TermsOfServiceContent";

interface Props {
  onClose: () => void;
  onAgree: () => void;
}

export default function TermsModal({ onClose, onAgree }: Props) {
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Terms of Service</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <TermsOfServiceContent effectiveClassName={styles.effective} />
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.closeTextBtn} onClick={onClose}>
            Close
          </button>
          <button type="button" className={styles.agreeBtn} onClick={onAgree}>
            I Agree
          </button>
        </div>
      </div>
    </div>
  );
}
