"use client";

import { useLanguage, type Language } from "@/lib/i18n/LanguageProvider";
import styles from "./LanguageToggle.module.css";

const OPTIONS: { value: Language; short: string }[] = [
  { value: "en", short: "EN" },
  { value: "fil", short: "FIL" },
];

/** English / Filipino switch (L1). */
export default function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  return (
    <div className={`${styles.toggle} ${className}`} role="group" aria-label={t.language.label}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.value}
          className={`${styles.option} ${lang === option.value ? styles.active : ""}`}
          aria-pressed={lang === option.value}
          title={t.language[option.value]}
          onClick={() => setLang(option.value)}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}
