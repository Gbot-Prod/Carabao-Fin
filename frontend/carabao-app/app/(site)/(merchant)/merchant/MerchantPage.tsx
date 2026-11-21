import styles from "./pageHeader.module.css";

/** Frame of one merchant page: eyebrow (nav group), title, count, blurb, actions, then the content. */
export default function MerchantPage({
  eyebrow,
  title,
  count,
  description,
  wideDescription = false,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  count?: React.ReactNode;
  description?: React.ReactNode;
  /** Let the blurb run the full width instead of wrapping at a reading width. */
  wideDescription?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.text}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>
            {title}
            {count !== undefined && count !== null && <span className={styles.count}>{count}</span>}
          </h1>
          {description && <p className={`${styles.description}${wideDescription ? ` ${styles.descriptionWide}` : ""}`}>{description}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {children}
    </div>
  );
}
