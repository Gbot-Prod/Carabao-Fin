"use client";

import Link from "next/link";
import styles from "./AuthPrompt.module.css";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** Why the prompt is shown; "cart" explains the signed-out cart (E4). */
export type AuthPromptReason = "default" | "cart";

type Props = {
  onDismiss: () => void;
  reason?: AuthPromptReason;
};

export default function AuthPrompt({ onDismiss, reason = "default" }: Props) {
  const { t } = useLanguage();
  const copy = reason === "cart" ? t.authPrompt.cart : t.authPrompt.default;

  return (
    <div className={styles.backdrop} onClick={onDismiss}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-prompt-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.icon}>
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div className={styles.text}>
          <h2 id="auth-prompt-title">{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
        <div className={styles.actions}>
          <Link href="/auth" className={styles.signInBtn}>
            {t.authPrompt.signIn}
          </Link>
          <Link href="/auth?mode=signup" className={styles.signUpBtn}>
            {t.authPrompt.signUp}
          </Link>
          <button type="button" className={styles.laterBtn} onClick={onDismiss}>
            {t.authPrompt.later}
          </button>
        </div>
      </div>
    </div>
  );
}
