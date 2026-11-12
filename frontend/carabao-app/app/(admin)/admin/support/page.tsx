"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/util/api/client";
import getApiErrorMessage from "@/util/errorHelper";
import OrderChat from "@/components/OrderChat/OrderChat";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";

type SupportConversation = {
  conversation_id: number;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
  last_message: string | null;
  last_at: string | null;
  unread: number;
};

/** CH2: admins read and answer support conversations (unanswered first). */
export default function AdminSupportPage() {
  const [rows, setRows] = useState<SupportConversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<SupportConversation[]>("/admin/support");
      setRows(res.data);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not load support conversations.");
      setRows((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  if (rows === null) return <PageLoader />;
  const current = rows.find((r) => r.conversation_id === selected) ?? null;

  return (
    <div className={styles.page}>
      <h1>Support</h1>
      <p>Messages users send from their profile. Unanswered conversations are listed first.</p>
      {error && <p role="alert">{error}</p>}
      {rows.length === 0 ? (
        <p>No support conversations yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Last message</th>
                <th>When</th>
                <th>Unread</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.conversation_id}
                  onClick={() => setSelected(r.conversation_id)}
                  style={{ cursor: "pointer", fontWeight: r.unread ? 700 : undefined }}
                  aria-selected={r.conversation_id === selected}
                >
                  <td>{r.user_name ?? r.user_email ?? `User #${r.user_id ?? "?"}`}</td>
                  <td>{r.last_message ?? "—"}</td>
                  <td>{r.last_at ? new Date(r.last_at).toLocaleString("en-PH") : "—"}</td>
                  <td>{r.unread || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {current && (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>{current.user_name ?? current.user_email ?? "User"}</h2>
            <button type="button" onClick={() => { setSelected(null); void load(); }}>Close</button>
          </div>
          <OrderChat
            key={current.conversation_id}
            endpoint={`/admin/support/${current.conversation_id}/messages`}
            title={current.user_email ?? "Support conversation"}
          />
        </section>
      )}
    </div>
  );
}
