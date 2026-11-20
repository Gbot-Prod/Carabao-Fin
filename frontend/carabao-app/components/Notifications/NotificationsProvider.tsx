"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useVisibleInterval } from "@/hooks/useVisibleInterval";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fetchNotifications, markNotificationRead, type AppNotification } from "@/util/api/notifications";
import { notificationTarget, openNotificationTarget } from "@/lib/notification-links";
import styles from "./NotificationToasts.module.css";

const POLL_MS = 30_000;
const TOAST_MS = 15_000;
const MAX_TOASTS = 3;

type NotificationsContextValue = {
  /** Unread count for the signed-in user (0 when signed out). */
  unread: number;
  /** Goes up each time new notifications arrive, so open lists can reload. */
  version: number;
  /** Re-read the unread count, e.g. after the notifications page changes something. */
  refresh: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue>({
  unread: 0,
  version: 0,
  refresh: async () => {},
});

export const useNotifications = () => useContext(NotificationsContext);

/**
 * Polls the signed-in user's notifications for the buyer site: keeps the
 * unread count for the sidebar and shows each new one as a toast in the top
 * right for 15 seconds. The full history lives on /notifications.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { isBackendAuthenticated } = useAuth();
  const [unread, setUnread] = useState(0);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  // Newest id seen so far. null until the first load, which only sets the
  // baseline: what was already there when the page opened is not toasted.
  const lastSeenId = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const page = await fetchNotifications({ limit: 10, audience: "buyer" });
      setUnread(page.unread);
      const newest = page.items.reduce((max, n) => Math.max(max, n.id), 0);
      const seen = lastSeenId.current;
      if (seen !== null) {
        const fresh = page.items.filter((n) => n.id > seen && !n.read);
        if (fresh.length > 0) {
          setVersion((v) => v + 1);
          // Newest on top; older toasts drop off past MAX_TOASTS.
          setToasts((prev) => [...fresh, ...prev].slice(0, MAX_TOASTS));
        }
      }
      lastSeenId.current = Math.max(seen ?? 0, newest);
    } catch {
      // Signed out or offline: keep the last state.
    }
  }, []);

  // CF-0047: paused while the tab is hidden, one poll when it is shown again.
  useVisibleInterval(refresh, POLL_MS, isBackendAuthenticated);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const markReadLocally = useCallback((id: number) => {
    setUnread((u) => Math.max(0, u - 1));
    setVersion((v) => v + 1);
    void markNotificationRead(id).catch(() => {});
  }, []);

  return (
    <NotificationsContext.Provider value={{ unread: isBackendAuthenticated ? unread : 0, version, refresh }}>
      {children}
      {isBackendAuthenticated && <NotificationToasts toasts={toasts} onDismiss={dismiss} onOpened={markReadLocally} />}
    </NotificationsContext.Provider>
  );
}

function NotificationToasts({
  toasts,
  onDismiss,
  onOpened,
}: {
  toasts: AppNotification[];
  onDismiss: (id: number) => void;
  onOpened: (id: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className={styles.region} role="region" aria-label={t.notificationsPage.toastRegion} aria-live="polite">
      {toasts.map((n) => (
        <Toast key={n.id} item={n} onDismiss={onDismiss} onOpened={onOpened} />
      ))}
    </div>
  );
}

function Toast({
  item,
  onDismiss,
  onOpened,
}: {
  item: AppNotification;
  onDismiss: (id: number) => void;
  onOpened: (id: number) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  // Time left, so pausing on hover or focus does not restart the full 15s.
  const remaining = useRef(TOAST_MS);

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(item.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, item.id, onDismiss]);

  const target = notificationTarget(item);

  const open = () => {
    onOpened(item.id);
    onDismiss(item.id);
    if (target) openNotificationTarget(target, router.push);
  };

  return (
    <div
      className={styles.toast}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <button type="button" className={styles.body} onClick={open}>
        <span className={styles.icon} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </span>
        <span className={styles.text}>
          <span className={styles.title}>{item.title}</span>
          {item.body && <span className={styles.message}>{item.body}</span>}
        </span>
      </button>
      <button type="button" className={styles.close} onClick={() => onDismiss(item.id)} aria-label={t.notificationsPage.dismiss}>
        &times;
      </button>
      <span
        className={styles.timer}
        style={{ animationDuration: `${TOAST_MS}ms`, animationPlayState: paused ? "paused" : "running" }}
        aria-hidden="true"
      />
    </div>
  );
}
