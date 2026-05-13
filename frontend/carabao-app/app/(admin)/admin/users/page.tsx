"use client";

import { useEffect, useState } from "react";
import { fetchAdminUsers, setUserAdminRole, type UserProfile } from "@/util/api/admin";
import styles from "./page.module.css";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);

  useEffect(() => {
    fetchAdminUsers()
      .then(setUsers)
      .catch(() => setError("Failed to load users."))
      .finally(() => setLoading(false));
  }, []);

  const handleRoleToggle = async (user: UserProfile) => {
    setToggling(user.id);
    try {
      const updated = await setUserAdminRole(user.id, !user.is_admin);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch {
      // leave state unchanged on error
    } finally {
      setToggling(null);
    }
  };

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
              <th>Role</th>
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
                <td>
                  <button
                    className={u.is_admin ? styles.roleAdmin : styles.roleUser}
                    onClick={() => void handleRoleToggle(u)}
                    disabled={toggling === u.id}
                    title={u.is_admin ? "Demote to user" : "Promote to admin"}
                  >
                    {toggling === u.id ? "…" : u.is_admin ? "Admin" : "User"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
