import styles from "./pageHeader.module.css";

/** Shared admin page header: eyebrow (nav group), title, optional count, blurb and actions. */
export default function PageHeader({
  eyebrow,
  title,
  count,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  count?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.header}>
      <div className={styles.text}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>
          {title}
          {count !== undefined && count !== null && <span className={styles.count}>{count}</span>}
        </h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  );
}
