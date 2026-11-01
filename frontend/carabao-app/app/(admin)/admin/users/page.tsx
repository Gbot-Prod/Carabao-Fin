"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ADMIN_PAGE_SIZE, fetchAdminUsers, setUserAdminRole, type UserProfile } from "@/util/api/admin";
import Pagination from "../../Pagination";
import styles from "./page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading users…" />}>
      <AdminUsersContent />
    </Suspense>
  );
}

function AdminUsersContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedPage, setLoadedPage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);

  useEffect(() => {
    fetchAdminUsers(page)
      .then((res) => {
        setUsers(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load users."))
      .finally(() => setLoadedPage(page));
  }, [page]);

  const loading = loadedPage !== page;

  const goToPage = (next: number) => {
    router.push(`${pathname}?page=${next}`);
  };

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

  if (loading && users.length === 0) return <PageLoader label="Loading users…" />;
  if (error) return <div className={styles.stateError}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Users <span className={styles.count}>{total}</span></h1>
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
                  <label className={`${styles.toggle} ${toggling === u.id ? styles.toggleBusy : ""}`} title={u.is_admin ? "Demote to user" : "Promote to admin"}>
                    <input
                      type="checkbox"
                      checked={u.is_admin}
                      disabled={toggling === u.id}
                      onChange={() => void handleRoleToggle(u)}
                    />
                    <span className={styles.toggleTrack}>
                      <span className={styles.toggleThumb} />
                    </span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={total} disabled={loading} onPageChange={goToPage} />
    </div>
  );
}
