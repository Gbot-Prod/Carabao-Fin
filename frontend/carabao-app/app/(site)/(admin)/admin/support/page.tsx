"use client";

import { Suspense, useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useVisibleInterval } from "@/hooks/useVisibleInterval";
import { apiClient } from "@/util/api/client";
import getApiErrorMessage from "@/util/errorHelper";
import OrderChat from "@/components/OrderChat/OrderChat";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import own from "./page.module.css";
import PageHeader from "../../PageHeader";
import TablePanel, { TablePage, TableSearch, TableSort, type SortOption } from "../../TablePanel";
import SortHeader, { readSort, writeSort, type SortState } from "../../SortHeader";

type SupportConversation = {
  conversation_id: number;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
  last_message: string | null;
  last_at: string | null;
  unread: number;
};

// Same as SUPPORT_LIST_DEFAULT in backend/app/api/routes/support_chat.py.
const SUPPORT_PAGE = 100;

type SupportSort = "unread" | "user" | "when";
const SORT_KEYS = ["unread", "user", "when"] as const;
/** The server's order when no sort is sent: unanswered first, then most recent. */
const DEFAULT_SORT: SortState<SupportSort> = { sort: "unread", order: "desc" };
const SORT_OPTIONS: SortOption<SupportSort>[] = [
  { key: "unread", label: "Unanswered first", firstOrder: "desc" },
  { key: "when", label: "Last message", firstOrder: "desc" },
  { key: "user", label: "User" },
];

/** CH2: admins read and answer support conversations (unanswered first). */
export default function AdminSupportPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading support…" />}>
      <SupportContent />
    </Suspense>
  );
}

function SupportContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // CF-0078 (B88): the API sends SUPPORT_PAGE at a time (CF-0076); the poll
  // reloads the page the admin is on.
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const q = searchParams.get("q")?.trim() ?? "";
  const current = readSort<SupportSort>(searchParams, SORT_KEYS, DEFAULT_SORT);
  const { sort, order } = current;
  const key = `${q}|${sort}|${order}|${page}`;

  const [rows, setRows] = useState<SupportConversation[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<SupportConversation[]>("/admin/support", {
        params: {
          limit: SUPPORT_PAGE,
          offset: (page - 1) * SUPPORT_PAGE,
          q: q || undefined,
          sort: sort ?? undefined,
          order,
        },
      });
      setRows(res.data);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not load support conversations.");
    } finally {
      setLoadedKey(`${q}|${sort}|${order}|${page}`);
    }
  }, [q, sort, order, page]);

  // CF-0047: paused while the tab is hidden, one poll when it is shown again.
  useVisibleInterval(load, 30_000);

  const loading = loadedKey !== key;
  const firstLoad = loadedKey === null;

  const go = (next: { q?: string; sort?: SortState<SupportSort>; page?: number }) => {
    const params = new URLSearchParams();
    const nextQ = next.q ?? q;
    const nextSort = next.sort ?? current;
    if (nextQ) params.set("q", nextQ);
    if (nextSort.sort !== DEFAULT_SORT.sort || nextSort.order !== DEFAULT_SORT.order) writeSort(params, nextSort);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const onSort = (next: SortState<SupportSort>) => go({ sort: next, page: 1 });

  const open = rows.find((r) => r.conversation_id === selected) ?? null;
  const close = () => {
    setSelected(null);
    void load();
  };

  let message: string | null = null;
  if (firstLoad) message = "Loading conversations…";
  else if (rows.length === 0)
    message = error ?? (q ? "No conversations match this search." : page > 1 ? "No older conversations." : "No support conversations yet.");

  return (
    <TablePage>
      <PageHeader
        eyebrow="Support"
        title="Support"
        count={firstLoad ? undefined : rows.length}
        description="Messages users send from their profile. Unanswered conversations are listed first."
      />
      <TablePanel
        // A failed poll keeps the last rows: say so above them.
        notice={error && rows.length > 0 ? { text: error, tone: "error" } : null}
        sort={<TableSort options={SORT_OPTIONS} current={current} onSort={onSort} defaultLabel="Unanswered first" />}
        search={<TableSearch applied={q} onSearch={(v) => go({ q: v, page: 1 })} placeholder="User name, email or #id" label="Search conversations" />}
        message={message}
        messageTone={error && rows.length === 0 ? "error" : undefined}
        loading={loading && !firstLoad}
        pagination={{
          page,
          pageSize: SUPPORT_PAGE,
          rows: rows.length,
          hasMore: rows.length >= SUPPORT_PAGE,
          onPageChange: (p) => go({ page: p }),
        }}
      >
        <table>
          <thead>
            <tr>
              <SortHeader label="User" sortKey="user" current={current} onSort={onSort} />
              <th>Last message</th>
              <SortHeader label="When" sortKey="when" current={current} onSort={onSort} firstOrder="desc" />
              <SortHeader label="Unread" sortKey="unread" current={current} onSort={onSort} firstOrder="desc" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.conversation_id}
                onClick={() => setSelected(r.conversation_id)}
                className={`${styles.row} ${r.conversation_id === selected ? styles.rowSelected : ""} ${r.unread ? own.unread : ""}`}
                aria-selected={r.conversation_id === selected}
              >
                <td>{r.user_name ?? r.user_email ?? `User #${r.user_id ?? "?"}`}</td>
                <td className={own.lastMessage}>{r.last_message ?? "—"}</td>
                <td className={styles.mono}>{r.last_at ? new Date(r.last_at).toLocaleString("en-PH") : "—"}</td>
                <td>{r.unread ? <span className={own.unreadCount}>{r.unread}</span> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TablePanel>

      {open && (
        <div className={styles.overlay} onClick={close}>
          <aside
            className={`${styles.panel} ${own.conversation}`}
            role="dialog"
            aria-label={`Conversation with ${open.user_name ?? open.user_email ?? "user"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.panelHeader}>
              <h2>{open.user_name ?? open.user_email ?? "User"}</h2>
              <button type="button" className={styles.close} onClick={close} aria-label="Close">
                ×
              </button>
            </div>
            <OrderChat
              key={open.conversation_id}
              endpoint={`/admin/support/${open.conversation_id}/messages`}
              title={open.user_email ?? "Support conversation"}
            />
          </aside>
        </div>
      )}
    </TablePage>
  );
}
