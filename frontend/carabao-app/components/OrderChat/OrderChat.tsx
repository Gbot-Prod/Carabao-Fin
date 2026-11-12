"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiClient } from "@/util/api/client";
import getApiErrorMessage from "@/util/errorHelper";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
import styles from "./OrderChat.module.css";

type Message = { id: number; sender_role: string; mine: boolean; body: string; created_at: string };
type Thread = { my_role: string; closed: boolean; closes_at: string | null; messages: Message[] };

const POLL_MS = 10_000;

/**
 * Order chat (CH1b) between the buyer and the farm; admins can read and join.
 * Also used for support chat (CH2) by passing `endpoint` (same message API shape).
 * Polls every 10 seconds while mounted (i.e. while the chat is open).
 */
export default function OrderChat({
  orderId,
  endpoint,
  title,
  emptyText,
}: {
  orderId?: number;
  endpoint?: string;
  title?: string;
  emptyText?: string;
}) {
  const { t } = useLanguage();
  const c = t.chat;
  const url = endpoint ?? `/orders/${orderId}/messages`;
  const inputId = `chat-${url.replace(/[^a-z0-9]+/gi, "-")}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [closed, setClosed] = useState(false);
  const [closesAt, setClosesAt] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastId = useRef(0);
  const listRef = useRef<HTMLOListElement | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await apiClient.get<Thread>(url, {
        params: { after_id: lastId.current },
      });
      const fresh = res.data.messages;
      if (fresh.length) {
        lastId.current = fresh[fresh.length - 1].id;
        setMessages((prev) => [...prev, ...fresh.filter((m) => !prev.some((p) => p.id === m.id))]);
      }
      setClosed(res.data.closed);
      setClosesAt(res.data.closes_at);
    } catch {
      // Keep the chat as it is; the next poll retries.
    } finally {
      setLoaded(true);
    }
  }, [url]);

  useEffect(() => {
    lastId.current = 0;
    const first = window.setTimeout(() => {
      setMessages([]);
      void poll();
    }, 0);
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [poll]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiClient.post<Message>(url, { body });
      lastId.current = Math.max(lastId.current, res.data.id);
      setMessages((prev) => [...prev, res.data]);
      setDraft("");
    } catch (err) {
      setError(getApiErrorMessage(err) ?? c.sendError);
    } finally {
      setSending(false);
    }
  };

  const who = (role: string) => c.roles[role as keyof typeof c.roles] ?? role;

  return (
    <section className={styles.chat} aria-label={title ?? c.title}>
      <h3 className={styles.title}>{title ?? c.title}</h3>
      {!loaded ? (
        <p className={styles.note}>{c.loading}</p>
      ) : messages.length === 0 ? (
        <p className={styles.note}>{emptyText ?? c.empty}</p>
      ) : (
        <ol className={styles.list} ref={listRef} aria-live="polite">
          {messages.map((m) => (
            <li key={m.id} className={`${styles.message} ${m.mine ? styles.mine : ""}`}>
              <span className={styles.meta}>
                {m.mine ? c.you : who(m.sender_role)} · {new Date(m.created_at).toLocaleString("en-PH")}
              </span>
              <span className={styles.body}>{m.body}</span>
            </li>
          ))}
        </ol>
      )}

      {closed ? (
        <p className={styles.note}>{c.closed}</p>
      ) : (
        <form className={styles.form} onSubmit={send}>
          <label className={styles.srOnly} htmlFor={inputId}>{c.placeholder}</label>
          <textarea
            id={inputId}
            rows={2}
            maxLength={2000}
            value={draft}
            placeholder={c.placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" disabled={sending || !draft.trim()}>{sending ? c.sending : c.send}</button>
        </form>
      )}
      {closesAt && !closed && (
        <p className={styles.note}>{fmt(c.closesOn, { date: new Date(closesAt).toLocaleDateString("en-PH") })}</p>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
