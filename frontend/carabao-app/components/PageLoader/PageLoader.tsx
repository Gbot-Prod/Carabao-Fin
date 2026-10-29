import styles from './PageLoader.module.css';

type PageLoaderProps = {
  label?: string;
  // page: fills the viewport. inline: sits inside a page section. compact: fits inside a card or panel.
  variant?: 'page' | 'inline' | 'compact';
};

export default function PageLoader({ label = 'Loading…', variant = 'page' }: PageLoaderProps) {
  return (
    <div className={`${styles.loader} ${styles[variant]}`} role="status" aria-live="polite">
      <div className={styles.spinner} aria-hidden />
      <p className={styles.label}>{label}</p>
    </div>
  );
}
