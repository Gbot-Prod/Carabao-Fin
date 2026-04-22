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
        <div className={styles.icon}>🔒</div>
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
