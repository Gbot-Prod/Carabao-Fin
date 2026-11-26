"use client";

import { createPortal } from "react-dom";
import { useHeaderSlot } from "./headerSlot";
import styles from "./pageHeader.module.css";

/**
 * Shared admin page header, one line in the topbar: title · description, plus
 * an optional count and actions. It renders into AdminShell's header slot, so
 * a page has one compact header bar instead of a topbar plus a title block.
 * `eyebrow` (the nav group) is kept for callers but no longer shown.
 */
export default function PageHeader({
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
  const slot = useHeaderSlot();
  if (!slot) return null;

  return createPortal(
    <div className={styles.header}>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {count !== undefined && count !== null && <span className={styles.count}>{count}</span>}
        {description && (
          <>
            <span className={styles.sep} aria-hidden="true">·</span>
            <p className={styles.description} title={typeof description === "string" ? description : undefined}>
              {description}
            </p>
          </>
        )}
      </div>
      {children && <div className={styles.actions}>{children}</div>}
    </div>,
    slot,
  );
}

/** A button in the page's topbar actions: Invite admin, Export CSV, Add word. */
export function HeaderButton({
  icon,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) {
  return (
    <button type="button" className={styles.action} {...props}>
      {icon}
      {children}
    </button>
  );
}
