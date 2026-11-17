"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import styles from "./SaveProduceButton.module.css";

type Props = {
  produceName: string | null;
  saved: boolean;
  busy?: boolean;
  onToggle: () => void;
};

/** Heart toggle for saving a listing (CF-0038). A button, so it sits outside card links. */
export default function SaveProduceButton({ produceName, saved, busy, onToggle }: Props) {
  const { t } = useLanguage();
  const name = produceName || t.saved.thisItem;
  const label = saved ? `${t.saved.unsave}: ${name}` : `${t.saved.save}: ${name}`;
  return (
    <button
      type="button"
      className={`${styles.button} ${saved ? styles.saved : ""}`}
      aria-pressed={saved}
      aria-label={label}
      title={saved ? t.saved.unsave : t.saved.save}
      disabled={busy}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.6 5c2.1 0 3.5 1.1 4.4 2.4C11.9 6.1 13.3 5 15.4 5 19 5 21 8.6 19.6 11.8 17.5 16.4 12 21 12 21z"
          fill={saved ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
