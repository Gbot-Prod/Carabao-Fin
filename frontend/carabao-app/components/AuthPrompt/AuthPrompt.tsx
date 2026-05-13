"use client";

import Link from "next/link";
import styles from "./AuthPrompt.module.css";

type Props = {
  onDismiss: () => void;
};

export default function AuthPrompt({ onDismiss }: Props) {
  return (
    <div className={styles.backdrop} onClick={onDismiss}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.icon}>
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div className={styles.text}>
          <h2>You need to be signed in for that</h2>
          <p>Create a free account or sign in to continue.</p>
        </div>
        <div className={styles.actions}>
          <Link href="/auth" className={styles.signInBtn}>
            Sign In
          </Link>
          <button type="button" className={styles.laterBtn} onClick={onDismiss}>
            Sign in later
          </button>
        </div>
      </div>
    </div>
  );
}
