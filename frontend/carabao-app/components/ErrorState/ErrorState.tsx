"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import styles from "./ErrorState.module.css";

type Props = {
  kind: "error" | "notFound";
  /** From an error boundary: re-render the segment. */
  onRetry?: () => void;
  /** Next.js error digest, shown so a user can quote it to support. */
  digest?: string;
  homeHref?: string;
};

/** Q1a: shared body of the error and not-found pages. */
export default function ErrorState({ kind, onRetry, digest, homeHref = "/" }: Props) {
  const { t } = useLanguage();
  const e = t.errors;
  const title = kind === "error" ? e.errorTitle : e.notFoundTitle;
  const body = kind === "error" ? e.errorBody : e.notFoundBody;

  return (
    <main className={styles.wrap} role={kind === "error" ? "alert" : undefined}>
      <span className={styles.code} aria-hidden="true">{kind === "error" ? "!" : "404"}</span>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.body}>{body}</p>
      <div className={styles.actions}>
        {onRetry && (
          <button type="button" className={styles.primary} onClick={onRetry}>
            {e.retry}
          </button>
        )}
        <Link href={homeHref} className={onRetry ? styles.secondary : styles.primary}>
          {e.home}
        </Link>
      </div>
      {digest && <p className={styles.digest}>{e.reference}: {digest}</p>}
    </main>
  );
}
