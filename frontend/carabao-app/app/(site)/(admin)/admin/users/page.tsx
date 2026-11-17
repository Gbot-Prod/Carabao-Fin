"use client";

import { formatPhMobile } from "@/lib/phone";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  fetchAdminUsers,
  resetAdminTwoFactor,
  setUserAdminRole,
  type UserProfile,
} from "@/util/api/admin";
import { getApiErrorDetail } from "@/util/errorHelper";
import { defaultAddress } from "@/util/api/users";
import Pagination from "@/components/Pagination/Pagination";
import SuspendControl from "../../SuspendControl";
import styles from "./page.module.css";
import PageHeader from "../../PageHeader";
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

  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [resetting, setResetting] = useState<number | null>(null);

  const channels = (sent: string[]) => sent.map((c) => (c === "sms" ? "SMS" : "email")).join(" and ");

  const handleRoleToggle = async (user: UserProfile) => {
    const promote = !user.is_admin;
    const confirmText = promote
      ? `Make ${user.name || "this user"} an admin? They get a one-time setup link by SMS and email, and must set up two-step verification before they can use the admin area.`
      : `Remove admin access from ${user.name || "this user"}? Their two-step verification is turned off and they are signed out.`;
    if (!window.confirm(confirmText)) return;
    setToggling(user.id);
    setNotice(null);
    try {
      const updated = await setUserAdminRole(user.id, promote);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      if (promote) setNotice({ text: "Admin access given. We sent the two-step setup link." });
    } catch (err) {
      setNotice({ text: getApiErrorDetail(err) || "Could not change the role.", error: true });
      // A 502 means the role changed but the link was not sent: reload the list.
      fetchAdminUsers(page).then((res) => setUsers(res.items)).catch(() => {});
    } finally {
      setToggling(null);
    }
  };

  const handleTwoFactorReset = async (user: UserProfile) => {
    const who = user.name || "this admin";
    const confirmText = user.two_factor_enabled
      ? `Reset two-step verification for ${who}? Their authenticator stops working, they are signed out, and a new setup link goes to their verified number and email.`
      : `Send a new setup link to ${who}? Links sent before this one stop working.`;
    if (!window.confirm(confirmText)) return;
    setResetting(user.id);
    setNotice(null);
    try {
      const { sent_to } = await resetAdminTwoFactor(user.id);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, two_factor_enabled: false } : u)));
      setNotice({
        text: `${user.two_factor_enabled ? "Two-step verification reset. " : ""}New setup link sent by ${channels(sent_to)}. Only this newest link works.`,
      });
    } catch (err) {
      setNotice({ text: getApiErrorDetail(err) || "Could not reset two-step verification.", error: true });
    } finally {
      setResetting(null);
    }
  };

  if (loading && users.length === 0) return <PageLoader label="Loading users…" />;
  if (error) return <div className={styles.stateError}>{error}</div>;

  return (
    <div className={styles.page}>
      <PageHeader eyebrow="People" title="Users" count={total} description="Everyone with a Carabao account. Toggle admin access or suspend an account." />
      {notice && (
        <p className={`${styles.notice} ${notice.error ? styles.noticeError : ""}`} role={notice.error ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
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
              <th>Account</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className={styles.mono}>{u.id}</td>
                <td>{u.name || <span className={styles.empty}>—</span>}</td>
                <td>{u.email ?? <span className={styles.empty}>—</span>}</td>
                <td>{u.phone_number ? formatPhMobile(u.phone_number) : <span className={styles.empty}>—</span>}</td>
                <td>{defaultAddress(u.addresses)?.city ?? <span className={styles.empty}>—</span>}</td>
                <td>{u.merchant ? u.merchant.merchant_name : <span className={styles.empty}>—</span>}</td>
                <td className={styles.mono}>{u.created_at ? new Date(u.created_at).toLocaleDateString("en-PH") : "—"}</td>
                <td>
                  <div className={styles.roleCell}>
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
                    {u.is_admin && (
                      <>
                        <span className={styles.twoFactor}>
                          {u.two_factor_enabled ? "2-step: on" : "2-step: not set up"}
                        </span>
                        <button
                          type="button"
                          className={styles.linkButton}
                          disabled={resetting === u.id}
                          onClick={() => void handleTwoFactorReset(u)}
                        >
                          {u.two_factor_enabled ? "Reset 2-step" : "Send new setup link"}
                        </button>
                      </>
                    )}
                  </div>
                </td>
                <td>
                  <SuspendControl
                    userId={u.id}
                    suspended={u.is_suspended}
                    reason={u.suspension_reason}
                    isMerchant={Boolean(u.merchant)}
                    onChange={(suspended, reason) =>
                      setUsers((prev) =>
                        prev.map((x) => (x.id === u.id ? { ...x, is_suspended: suspended, suspension_reason: reason } : x)),
                      )
                    }
                  />
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
