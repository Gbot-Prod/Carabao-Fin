"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AUDIT_PAGE_SIZE,
  fetchAuditActions,
  fetchAuditLog,
  type AuditLogEntry,
  type AuditSort,
} from "@/util/api/admin";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import own from "./page.module.css";
import PageHeader from "../../PageHeader";
import TablePanel, { TablePage, TableFilter, TableSearch, TableSort, type SortOption } from "../../TablePanel";
import SortHeader, { readSort, writeSort, type SortState } from "../../SortHeader";

const SORT_KEYS = ["when", "admin", "action", "target"] as const;
/** The server's order when no sort is sent: newest first. */
const DEFAULT_SORT: SortState<AuditSort> = { sort: "when", order: "desc" };
const SORT_OPTIONS: SortOption<AuditSort>[] = [
  { key: "when", label: "When", firstOrder: "desc" },
  { key: "admin", label: "Admin" },
  { key: "action", label: "Action" },
  { key: "target", label: "Target" },
];

const ACTION_LABELS: Record<string, string> = {
  "user.role_change": "Role change",
  "user.two_factor_reset": "Two-step reset",
  "admin.invite": "Admin invited",
  "admin.invite_resent": "Admin invite resent",
  "admin.invite_locked": "Admin invite locked (wrong codes)",
  "admin.invite_accepted": "Admin invite accepted",
  "admin.two_factor_enrolled": "Admin two-step set up",
  "admin.account_reset": "Admin account reset",
  "admin.deactivate": "Admin deactivated",
  "admin.reactivate": "Admin reactivated",
  "admin.create": "Admin created (script)",
  "admin.recover": "Admin recovered (script)",
  "user.suspend": "Suspension",
  "user.reinstate": "Reinstatement",
  "merchant_application.review": "Application review",
  "payout.release": "Payout release",
  "transaction.refund": "Refund",
  "transaction.refund_sent": "Refund sent to PayMongo",
  "produce.hide": "Listing hidden",
  "produce.unhide": "Listing unhidden",
  "produce.approve": "Listing approved",
  "produce.reject": "Listing rejected",
  "prohibited_term.create": "Word added",
  "prohibited_term.update": "Word changed",
  "review.hide": "Review hidden",
  "review.unhide": "Review restored",
  "order.cancel": "Order cancelled",
  "order.dispute_decision": "Delivery dispute decided",
};

const TARGET_LINKS: Partial<Record<string, (id: number) => string>> = {
  user: () => "/admin/users",
  merchant_application: () => "/admin/review",
  payout_batch: () => "/admin/payouts",
  transaction: () => "/admin/refunds",
  produce: () => "/admin/listings",
  prohibited_term: () => "/admin/terms",
  review: () => "/admin/reviews",
  order: () => "/admin/orders",
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
  const q = searchParams.get("q")?.trim() ?? "";
  const current = readSort<AuditSort>(searchParams, SORT_KEYS, DEFAULT_SORT);
  const { sort, order } = current;
  const key = `${action}|${q}|${sort}|${order}|${page}`;

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<string[]>([]);

  useEffect(() => {
    fetchAuditActions().then(setActions).catch(() => setActions(Object.keys(ACTION_LABELS)));
  }, []);

  useEffect(() => {
    fetchAuditLog({ action: action || undefined, q: q || undefined, sort: sort ?? undefined, order }, page)
      .then((res) => {
        setEntries(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load the audit log."))
      .finally(() => setLoadedKey(`${action}|${q}|${sort}|${order}|${page}`));
  }, [action, q, sort, order, page]);

  const loading = loadedKey !== key;

  const go = (next: { action?: string; q?: string; sort?: SortState<AuditSort>; page?: number }) => {
    const params = new URLSearchParams();
    const a = next.action ?? action;
    const nextQ = next.q ?? q;
    const nextSort = next.sort ?? current;
    if (a) params.set("action", a);
    if (nextQ) params.set("q", nextQ);
    if (nextSort.sort !== DEFAULT_SORT.sort || nextSort.order !== DEFAULT_SORT.order) writeSort(params, nextSort);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const onSort = (next: SortState<AuditSort>) => go({ sort: next, page: 1 });

  const firstLoad = loading && entries.length === 0 && !error;

  return (
    <TablePage>
      <PageHeader
        eyebrow="Support"
        title="Audit log"
        count={total}
        description={<>Every admin action, with who did it, when, and what changed. Entries can&apos;t be edited or deleted.</>}
      />

      <TablePanel
        activeFilters={[action].filter(Boolean).length}
        filters={
          <TableFilter label="Action" value={action} onChange={(v) => go({ action: v, page: 1 })}>
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>)}
          </TableFilter>
        }
        sort={<TableSort options={SORT_OPTIONS} current={current} onSort={onSort} defaultLabel="Newest first" />}
        search={<TableSearch applied={q} onSearch={(v) => go({ q: v, page: 1 })} placeholder="Admin email, action or #target" label="Search the audit log" />}
        message={firstLoad ? "Loading audit log…" : error ?? (entries.length === 0 ? `No admin actions recorded${action ? " for this action" : ""} yet.` : null)}
        messageTone={error ? "error" : undefined}
        loading={loading}
        pagination={{ page, pageSize: AUDIT_PAGE_SIZE, total, onPageChange: (p) => go({ page: p }) }}
      >
          <table>
            <thead>
              <tr>
                <SortHeader label="When" sortKey="when" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Admin" sortKey="admin" current={current} onSort={onSort} />
                <SortHeader label="Action" sortKey="action" current={current} onSort={onSort} />
                <SortHeader label="Target" sortKey="target" current={current} onSort={onSort} />
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
      </TablePanel>
    </TablePage>
  );
}
