"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/util/api/client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import styles from "./NotificationBell.module.css";

type Item = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

const POLL_MS = 60_000;

/** The notification bell (U5): unread count, latest items, mark read. */
export default function NotificationBell() {
  const { t } = useLanguage();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ items: Item[]; unread: number }>("/users/me/notifications", {
        params: { limit: 15 },
      });
      setItems(res.data.items);
      setUnread(res.data.unread);
    } catch {
      // Signed out or offline: keep the last state.
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const openItem = async (item: Item) => {
    if (!item.read) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      setUnread((u) => Math.max(0, u - 1));
      void apiClient.post(`/users/me/notifications/${item.id}/read`).catch(() => {});
    }
    setOpen(false);
    if (item.link) router.push(item.link);
  };

  const markAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    void apiClient.post("/users/me/notifications/read-all").catch(() => {});
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.bell}
        aria-label={unread > 0 ? `${t.notificationsBell.title} (${unread})` : t.notificationsBell.title}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className={styles.badge}>{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label={t.notificationsBell.title}>
          <div className={styles.panelHeader}>
            <strong>{t.notificationsBell.title}</strong>
            {unread > 0 && (
              <button type="button" className={styles.markAll} onClick={() => void markAll()}>
                {t.notificationsBell.markAll}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className={styles.empty}>{t.notificationsBell.empty}</p>
          ) : (
            <ul className={styles.list}>
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`${styles.item} ${n.read ? "" : styles.unread}`} onClick={() => void openItem(n)}>
                    <span className={styles.itemTitle}>{n.title}</span>
                    {n.body && <span className={styles.itemBody}>{n.body}</span>}
                    <span className={styles.itemTime}>{new Date(n.created_at).toLocaleString("en-PH")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
