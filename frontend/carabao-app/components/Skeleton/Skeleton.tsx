import styles from "./Skeleton.module.css";

type Props = {
  /** Read by screen readers while the content loads. */
  label: string;
  rows?: number;
  /** Show a square thumbnail on each row (e.g. cart items). */
  thumbnail?: boolean;
};

/** Q1b: placeholder rows shaped like the list that is loading. */
export default function SkeletonList({ label, rows = 3, thumbnail = false }: Props) {
  return (
    <div className={styles.list} role="status" aria-busy="true" aria-live="polite">
      <span className={styles.srOnly}>{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.row} aria-hidden="true">
          {thumbnail && <div className={`${styles.block} ${styles.thumb}`} />}
          <div className={styles.lines}>
            <div className={`${styles.block} ${styles.line}`} />
            <div className={`${styles.block} ${styles.line} ${styles.short}`} />
            <div className={`${styles.block} ${styles.line} ${styles.shorter}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Q1b: a load failure with a retry, so an outage isn't shown as "nothing here". */
export function LoadError({ message, onRetry, retryLabel = "Try again" }: { message: string; onRetry: () => void; retryLabel?: string }) {
  return (
    <div className={styles.error} role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>{retryLabel}</button>
    </div>
  );
}
