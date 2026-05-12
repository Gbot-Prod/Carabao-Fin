"use client";

import { useEffect, useState } from "react";
import { fetchAdminUsers, type UserProfile } from "@/util/api/admin";
import styles from "./page.module.css";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminUsers()
      .then(setUsers)
      .catch(() => setError("Failed to load users."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.state}>Loading…</div>;
  if (error) return <div className={styles.stateError}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Users <span className={styles.count}>{users.length}</span></h1>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>City</th>
              <th>Merchant</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className={styles.mono}>{u.id}</td>
                <td>{[u.first_name, u.last_name].filter(Boolean).join(" ") || <span className={styles.empty}>—</span>}</td>
                <td>{u.email}</td>
                <td>{u.phone_number ?? <span className={styles.empty}>—</span>}</td>
                <td>{u.city ?? <span className={styles.empty}>—</span>}</td>
                <td>{u.merchant ? u.merchant.merchant_name : <span className={styles.empty}>—</span>}</td>
                <td className={styles.mono}>{u.created_at ? new Date(u.created_at).toLocaleDateString("en-PH") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
