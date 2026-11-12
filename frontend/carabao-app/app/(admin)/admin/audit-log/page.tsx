"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AUDIT_PAGE_SIZE,
  fetchAuditActions,
  fetchAuditLog,
  type AuditLogEntry,
} from "@/util/api/admin";
import Pagination from "../../Pagination";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import own from "./page.module.css";

const ACTION_LABELS: Record<string, string> = {
  "user.role_change": "Role change",
  "user.suspend": "Suspension",
  "user.reinstate": "Reinstatement",
  "merchant_application.review": "Application review",
  "payout.release": "Payout release",
  "transaction.refund": "Refund",
  "produce.hide": "Listing hidden",
  "produce.unhide": "Listing unhidden",
};

const TARGET_LINKS: Partial<Record<string, (id: number) => string>> = {
  user: () => "/admin/users",
  merchant_application: () => "/admin/review",
  payout_batch: () => "/admin/payouts",
  transaction: () => "/admin/refunds",
  produce: () => "/admin/listings",
};

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString("en-PH");
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

/** Fields whose value differs between before and after (all of them on create). */
function changes(entry: AuditLogEntry) {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return keys
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ key: k, from: before[k], to: after[k] }));
}

export default function AdminAuditLogPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading audit log…" />}>
      <AuditLogContent />
    </Suspense>
  );
}

function AuditLogContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const action = searchParams.get("action") || "";
  const key = `${action}|${page}`;

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<string[]>([]);

  useEffect(() => {
    fetchAuditActions().then(setActions).catch(() => setActions(Object.keys(ACTION_LABELS)));
  }, []);

  useEffect(() => {
    fetchAuditLog({ action: action || undefined }, page)
      .then((res) => {
        setEntries(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load the audit log."))
      .finally(() => setLoadedKey(`${action}|${page}`));
  }, [action, page]);

  const loading = loadedKey !== key;

  const go = (next: { action?: string; page?: number }) => {
    const params = new URLSearchParams();
    const a = next.action ?? action;
    if (a) params.set("action", a);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  if (loading && entries.length === 0 && !error) return <PageLoader label="Loading audit log…" />;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Audit log <span className={styles.count}>{total}</span></h1>
      <p className={own.intro}>Every admin action, with who did it, when, and what changed. Entries can&apos;t be edited or deleted.</p>

      <div className={styles.filters}>
        <label className={styles.field}>
          <span>Action</span>
          <select value={action} onChange={(e) => go({ action: e.target.value, page: 1 })}>
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>)}
          </select>
        </label>
      </div>

      {error ? (
        <div className={styles.stateError}>{error}</div>
      ) : entries.length === 0 ? (
        <div className={styles.state}>No admin actions recorded{action ? " for this action" : ""} yet.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Target</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const diff = changes(entry);
                const link = TARGET_LINKS[entry.target_type];
                return (
                  <tr key={entry.id}>
                    <td className={styles.mono}>{new Date(entry.created_at).toLocaleString("en-PH")}</td>
                    <td>{entry.admin_email}</td>
                    <td><span className={styles.badge}>{ACTION_LABELS[entry.action] ?? entry.action}</span></td>
                    <td>
                      {link && entry.target_id !== null ? (
                        <a className={styles.linkButton} href={link(entry.target_id)}>
                          {entry.target_type.replace(/_/g, " ")} #{entry.target_id}
                        </a>
                      ) : (
                        `${entry.target_type.replace(/_/g, " ")}${entry.target_id !== null ? ` #${entry.target_id}` : ""}`
                      )}
                    </td>
                    <td className={own.changeCell}>
                      {diff.length === 0 ? (
                        <span className={styles.empty}>No field changed</span>
                      ) : (
                        <ul className={own.changes}>
                          {diff.map((c) => (
                            <li key={c.key}>
                              <span className={own.field}>{c.key.replace(/_/g, " ")}</span>{" "}
                              <span className={own.from}>{show(c.from)}</span> → <span className={own.to}>{show(c.to)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={AUDIT_PAGE_SIZE} total={total} disabled={loading} onPageChange={(p) => go({ page: p })} />
    </div>
  );
}
