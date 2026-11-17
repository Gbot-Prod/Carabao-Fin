"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import SkeletonList, { LoadError } from "@/components/Skeleton/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
import { useNotifications } from "@/components/Notifications/NotificationsProvider";
import { notificationTarget, openNotificationTarget } from "@/lib/notification-links";
import {
  deleteNotification,
  deleteReadNotifications,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  type AppNotification,
} from "@/util/api/notifications";

const PAGE_SIZE = 20;
const MAX_RELOAD = 100; // backend limit per request

type Filter = "all" | "unread";

const formatTime = (value: string) =>
  new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Every notification the user has, with read/unread and delete (U5). */
export default function NotificationsPage() {
  const { t } = useLanguage();
  const s = t.notificationsPage;
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { version, refresh } = useNotifications();

  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // How many rows are shown, so a background reload keeps "Show more" pages.
  const shownRef = useRef(PAGE_SIZE);

  const load = useCallback(
    async (limit: number) => {
      try {
        // In requests of MAX_RELOAD, so rows loaded with "Show more" stay on a reload.
        const rows: AppNotification[] = [];
        let page;
        do {
          page = await fetchNotifications({
            limit: Math.min(limit - rows.length, MAX_RELOAD),
            offset: rows.length,
            unreadOnly: filter === "unread",
          });
          rows.push(...page.items);
        } while (rows.length < limit && rows.length < page.total && page.items.length > 0);
        setItems(rows);
        setTotal(page.total);
        setUnread(page.unread);
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    },
    [filter]
  );

  // First load, filter change, and whenever new notifications arrive.
  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = window.setTimeout(() => void load(Math.max(PAGE_SIZE, shownRef.current)), 0);
    return () => window.clearTimeout(timer);
  }, [isAuthenticated, load, version]);

  useEffect(() => {
    shownRef.current = Math.max(PAGE_SIZE, items.length);
  }, [items.length]);

  const changeFilter = (next: Filter) => {
    if (next === filter) return;
    shownRef.current = PAGE_SIZE;
    setStatus("loading");
    setFilter(next);
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await fetchNotifications({ limit: PAGE_SIZE, offset: items.length, unreadOnly: filter === "unread" });
      setItems((prev) => {
        const have = new Set(prev.map((n) => n.id));
        return [...prev, ...page.items.filter((n) => !have.has(n.id))];
      });
      setTotal(page.total);
      setUnread(page.unread);
    } catch {
      setActionError(s.actionError);
    } finally {
      setLoadingMore(false);
    }
  };

  // Optimistic change, then sync with the server (and the sidebar count).
  const run = async (apply: () => void, call: () => Promise<void>) => {
    setActionError(null);
    apply();
    try {
      await call();
    } catch {
      setActionError(s.actionError);
      await load(shownRef.current);
    }
    void refresh();
  };

  const setRead = (n: AppNotification, read: boolean) =>
    run(
      () => {
        setUnread((u) => Math.max(0, u + (read ? -1 : 1)));
        if (filter === "unread" && read) {
          setItems((prev) => prev.filter((x) => x.id !== n.id));
          setTotal((c) => Math.max(0, c - 1));
        } else {
          setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read } : x)));
        }
      },
      () => (read ? markNotificationRead(n.id) : markNotificationUnread(n.id))
    );

  const remove = (n: AppNotification) =>
    run(
      () => {
        setItems((prev) => prev.filter((x) => x.id !== n.id));
        setTotal((c) => Math.max(0, c - 1));
        if (!n.read) setUnread((u) => Math.max(0, u - 1));
      },
      () => deleteNotification(n.id)
    );

  const markAll = async () => {
    setBusy(true);
    await run(
      () => {
        setUnread(0);
        if (filter === "unread") {
          setItems([]);
          setTotal(0);
        } else {
          setItems((prev) => prev.map((x) => ({ ...x, read: true })));
        }
      },
      markAllNotificationsRead
    );
    setBusy(false);
  };

  const clearRead = async () => {
    if (!window.confirm(s.clearReadConfirm)) return;
    setBusy(true);
    await run(() => {}, deleteReadNotifications);
    await load(PAGE_SIZE);
    setBusy(false);
  };

  const open = (n: AppNotification, target: string) => {
    if (!n.read) void setRead(n, true);
    openNotificationTarget(target, router.push);
  };

  const hasRead = filter === "all" && items.some((n) => n.read);

  let content: React.ReactNode;
  if (!authLoading && !isAuthenticated) {
    content = (
      <div className={styles.empty}>
        <p>{s.signedOut}</p>
        <Link href="/auth" className={styles.primary}>{t.nav.signIn}</Link>
      </div>
    );
  } else if (authLoading || status === "loading") {
    content = <SkeletonList label={s.loading} rows={4} />;
  } else if (status === "error") {
    content = <LoadError message={s.loadError} retryLabel={s.retry} onRetry={() => { setStatus("loading"); void load(PAGE_SIZE); }} />;
  } else if (items.length === 0) {
    content = (
      <div className={styles.empty}>
        <p>{filter === "unread" ? s.emptyUnread : s.empty}</p>
      </div>
    );
  } else {
    content = (
      <>
        <ul className={styles.list}>
          {items.map((n) => {
            const target = notificationTarget(n);
            return (
              <li key={n.id} className={`${styles.card} ${n.read ? "" : styles.cardUnread}`}>
                <span className={styles.dot} aria-hidden="true" />
                <div className={styles.main}>
                  {target ? (
                    <button type="button" className={styles.titleButton} onClick={() => open(n, target)}>
                      {n.title}
                    </button>
                  ) : (
                    <span className={styles.title}>{n.title}</span>
                  )}
                  {n.body && <p className={styles.body}>{n.body}</p>}
                  <time className={styles.time} dateTime={n.created_at}>{formatTime(n.created_at)}</time>
                </div>
                <div className={styles.actions}>
                  {target && (
                    <button type="button" className={styles.action} onClick={() => open(n, target)}>
                      {s.open}
                    </button>
                  )}
                  <button type="button" className={styles.action} onClick={() => void setRead(n, !n.read)}>
                    {n.read ? s.markUnread : s.markRead}
                  </button>
                  <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => void remove(n)}>
                    {s.remove}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {items.length < total && (
          <button type="button" className={styles.more} onClick={() => void loadMore()} disabled={loadingMore}>
            {s.more}
          </button>
        )}
      </>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{s.eyebrow}</p>
          <h1 className={styles.title1}>{t.notificationsBell.title}</h1>
          {isAuthenticated && status === "ready" && (
            <p className={styles.count}>{fmt(s.unreadCount, { count: unread })}</p>
          )}
        </div>
        {isAuthenticated && (
          <div className={styles.headerActions}>
            <button type="button" className={styles.secondary} onClick={() => void markAll()} disabled={busy || unread === 0}>
              {s.markAll}
            </button>
            <button type="button" className={`${styles.secondary} ${styles.danger}`} onClick={() => void clearRead()} disabled={busy || !hasRead}>
              {s.clearRead}
            </button>
          </div>
        )}
      </header>

      {isAuthenticated && (
        <div className={styles.tabs} role="tablist">
          {(["all", "unread"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={`${styles.tab} ${filter === f ? styles.tabActive : ""}`}
              onClick={() => changeFilter(f)}
            >
              {f === "all" ? s.filterAll : s.filterUnread}
            </button>
          ))}
        </div>
      )}

      {actionError && <p className={styles.error} role="alert">{actionError}</p>}

      {content}
    </div>
  );
}
