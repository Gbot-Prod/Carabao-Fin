"use client";

import { formatPhMobile } from "@/lib/phone";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  deactivateAdmin,
  fetchAdminUsers,
  inviteAdmin,
  reactivateAdmin,
  resendAdminInvite,
  resetAdminAccount,
  type AdminUserRole,
  type AdminUserSort,
  type UserProfile,
} from "@/util/api/admin";
import { getApiErrorDetail, getApiErrorStatus } from "@/util/errorHelper";
import { defaultAddress } from "@/util/api/users";
import Pagination from "@/components/Pagination/Pagination";
import SuspendControl from "../../SuspendControl";
import styles from "./page.module.css";
import PageHeader from "../../PageHeader";
import PageLoader from "@/components/PageLoader/PageLoader";
import FieldError, { focusFirstInvalid, invalidClass, invalidProps } from "@/components/FieldError/FieldError";
import SortHeader, { readSort, writeSort, type SortState } from "../../SortHeader";

const SORT_KEYS = ["id", "name", "email", "joined"] as const;

// "" shows every account.
type RoleView = "" | AdminUserRole;
const ROLE_VIEWS: { value: RoleView; label: string }[] = [
  { value: "", label: "All" },
  { value: "user", label: "Users" },
  { value: "admin", label: "Admins" },
];

// Admin accounts (DB_ROLE_SPLIT_PLAN.md section 2): admins are invited, never
// promoted. An invite emails a link; the code is shown here once, for the
// inviting admin to hand over directly. An admin's access is removed by
// deactivation, not by suspension or deletion.

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading users…" />}>
      <AdminUsersContent />
    </Suspense>
  );
}

type IssuedCode = { email: string; code: string; why: string };

function AdminUsersContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const roleParam = searchParams.get("role");
  const role: RoleView = roleParam === "user" || roleParam === "admin" ? roleParam : "";
  const { sort, order } = readSort<AdminUserSort>(searchParams, SORT_KEYS);
  const current: SortState<AdminUserSort> = { sort, order };
  const key = `${role}|${sort ?? ""}|${order}|${page}`;

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = () => fetchAdminUsers(page, { role: role || undefined, ...(sort ? { sort, order } : {}) });

  useEffect(() => {
    fetchAdminUsers(page, { role: role || undefined, ...(sort ? { sort, order } : {}) })
      .then((res) => {
        setUsers(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load users."))
      .finally(() => setLoadedKey(`${role}|${sort ?? ""}|${order}|${page}`));
  }, [role, sort, order, page]);

  const loading = loadedKey !== key;

  const go = (next: { role?: RoleView; sort?: SortState<AdminUserSort>; page?: number }) => {
    const params = new URLSearchParams();
    const nextRole = next.role ?? role;
    if (nextRole) params.set("role", nextRole);
    writeSort(params, next.sort ?? current);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const onSort = (next: SortState<AdminUserSort>) => go({ sort: next, page: 1 });

  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [issued, setIssued] = useState<IssuedCode | null>(null);

  const replaceUser = (updated: UserProfile) =>
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));

  const reload = () =>
    query()
      .then((res) => {
        setUsers(res.items);
        setTotal(res.total);
      })
      .catch(() =>
        // CF-0067 (B74): say so, instead of leaving stale rows without a word.
        setNotice({ text: "Could not reload the list. Refresh the page to see the current state.", error: true }),
      );

  const run = async (user: UserProfile, confirmText: string, action: () => Promise<void>, failText: string) => {
    if (!window.confirm(confirmText)) return;
    setBusy(user.id);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setNotice({ text: getApiErrorDetail(err) || failText, error: true });
      // A 502 means the change was saved but the message was not sent.
      if (getApiErrorStatus(err) === 502) void reload();
    } finally {
      setBusy(null);
    }
  };

  const who = (user: UserProfile) => user.name || user.email || "this admin";

  const handleAccountReset = (user: UserProfile) =>
    run(
      user,
      `Reset the account of ${who(user)}? Their password and authenticator stop working and they are signed out. A new invite link goes to their email, and you get a new code to give them.`,
      async () => {
        const res = await resetAdminAccount(user.id);
        replaceUser(res.user);
        setIssued({ email: user.email ?? "", code: res.code, why: "Account reset. New invite sent." });
      },
      "Could not reset the account.",
    );

  const handleResend = (user: UserProfile) =>
    run(
      user,
      `Send a new invite to ${who(user)}? The old link and code stop working.`,
      async () => {
        const res = await resendAdminInvite(user.id);
        replaceUser(res.user);
        setIssued({ email: user.email ?? "", code: res.code, why: "New invite sent." });
      },
      "Could not resend the invite.",
    );

  const handleDeactivate = (user: UserProfile) =>
    run(
      user,
      `Deactivate ${who(user)}? They are signed out, cannot sign in, and their two-step verification is turned off. Their history is kept, and you can reactivate them later.`,
      async () => {
        replaceUser(await deactivateAdmin(user.id));
        setNotice({ text: `${who(user)} was deactivated.` });
      },
      "Could not deactivate.",
    );

  const handleReactivate = (user: UserProfile) =>
    run(
      user,
      `Reactivate ${who(user)}? A new invite link goes to their email, and you get a new code to give them. They choose a new password and set up their authenticator again.`,
      async () => {
        const res = await reactivateAdmin(user.id);
        replaceUser(res.user);
        setIssued({ email: user.email ?? "", code: res.code, why: "Reactivated with a new invite." });
      },
      "Could not reactivate.",
    );

  if (loading && users.length === 0) return <PageLoader label="Loading users…" />;
  if (error) return <div className={styles.stateError}>{error}</div>;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="People"
        title="Users"
        count={total}
        description="Everyone with a Carabao account. Invite admins, manage their access, or suspend a buyer or merchant account."
      />
      <InviteAdminForm
        onInvited={(invite, email) => {
          setNotice(null);
          setIssued({ email, code: invite.code, why: "Invite sent." });
          // The Users view shows no admins.
          if (role === "user") return;
          setUsers((prev) => (prev.some((u) => u.id === invite.user.id) ? prev : [...prev, invite.user]));
          setTotal((t) => t + 1);
        }}
      />
      {issued && <CodePanel issued={issued} onDone={() => setIssued(null)} />}
      <div className={styles.roleToggle} role="group" aria-label="Show accounts">
        {ROLE_VIEWS.map((v) => (
          <button
            key={v.value || "all"}
            type="button"
            className={`${styles.roleOption} ${role === v.value ? styles.roleOptionActive : ""}`}
            aria-pressed={role === v.value}
            disabled={loading}
            onClick={() => go({ role: v.value, page: 1 })}
          >
            {v.label}
          </button>
        ))}
      </div>
      {notice && (
        <p className={`${styles.notice} ${notice.error ? styles.noticeError : ""}`} role={notice.error ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <SortHeader label="ID" sortKey="id" current={current} onSort={onSort} />
              <SortHeader label="Name" sortKey="name" current={current} onSort={onSort} />
              <SortHeader label="Email" sortKey="email" current={current} onSort={onSort} />
              <th>Phone</th>
              <th>City</th>
              <th>Merchant</th>
              <SortHeader label="Joined" sortKey="joined" current={current} onSort={onSort} firstOrder="desc" />
              <th>Role</th>
              <th>Account</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={9} className={styles.empty}>
                  {role === "admin" ? "No admin accounts." : "No accounts."}
                </td>
              </tr>
            )}
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
                  {u.is_admin ? (
                    <div className={styles.roleCell}>
                      <span className={styles.adminBadge}>Admin</span>
                      <span className={styles.twoFactor}>{adminStatus(u)}</span>
                    </div>
                  ) : (
                    <span className={styles.empty}>User</span>
                  )}
                </td>
                <td>
                  {u.is_admin ? (
                    <div className={styles.roleCell}>
                      {!u.is_suspended && u.admin_invite_pending && (
                        <button type="button" className={styles.linkButton} disabled={busy === u.id} onClick={() => void handleResend(u)}>
                          Resend invite
                        </button>
                      )}
                      {!u.is_suspended && !u.admin_invite_pending && (
                        <button type="button" className={styles.linkButton} disabled={busy === u.id} onClick={() => void handleAccountReset(u)}>
                          Reset account
                        </button>
                      )}
                      {u.is_suspended ? (
                        <button type="button" className={styles.linkButton} disabled={busy === u.id} onClick={() => void handleReactivate(u)}>
                          Reactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`${styles.linkButton} ${styles.dangerLink}`}
                          disabled={busy === u.id}
                          onClick={() => void handleDeactivate(u)}
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  ) : (
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
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={total} disabled={loading} onPageChange={(p) => go({ page: p })} />
    </div>
  );
}

function adminStatus(u: UserProfile): string {
  if (u.is_suspended) return "Deactivated";
  if (u.admin_invite_pending) return "Invite pending";
  return u.two_factor_enabled ? "2-step: on" : "2-step: not set up";
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function InviteAdminForm({ onInvited }: { onInvited: (invite: Awaited<ReturnType<typeof inviteAdmin>>, email: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Enter the new admin's name.";
    if (!EMAIL_SHAPE.test(email.trim())) next.email = "Enter a valid email address.";
    setErrors(next);
    if (next.name || next.email) {
      requestAnimationFrame(focusFirstInvalid);
      return;
    }
    setBusy(true);
    try {
      const invite = await inviteAdmin(email.trim(), name.trim());
      onInvited(invite, email.trim().toLowerCase());
      setName("");
      setEmail("");
      setOpen(false);
    } catch (err) {
      const status = getApiErrorStatus(err);
      const detail = getApiErrorDetail(err) || "Could not send the invite.";
      // The email is the field at fault for "already has an account" and "not valid".
      setErrors(status === 409 || status === 422 ? { email: detail } : { form: detail });
      requestAnimationFrame(focusFirstInvalid);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className={styles.inviteBar}>
        <button type="button" className={styles.primaryButton} onClick={() => setOpen(true)}>
          Invite admin
        </button>
      </div>
    );
  }

  return (
    <form className={styles.inviteForm} onSubmit={submit} noValidate>
      <h2 className={styles.inviteTitle}>Invite an admin</h2>
      <p className={styles.inviteHelp}>
        Use an email that has no Carabao account yet: admin accounts are separate from buyer and merchant accounts. We
        email a link; you get a code to give them yourself.
      </p>
      <div className={styles.inviteFields}>
        <div className={`${styles.field}${invalidClass(errors.name)}`}>
          <label htmlFor="invite-name">Name</label>
          <input
            id="invite-name"
            className={styles.input}
            value={name}
            maxLength={100}
            {...invalidProps("invite-name", errors.name)}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((x) => ({ ...x, name: undefined }));
            }}
            autoFocus
          />
          <FieldError id="invite-name" message={errors.name} />
        </div>
        <div className={`${styles.field}${invalidClass(errors.email)}`}>
          <label htmlFor="invite-email">Email</label>
          <input
            id="invite-email"
            className={styles.input}
            type="email"
            value={email}
            maxLength={254}
            {...invalidProps("invite-email", errors.email)}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors((x) => ({ ...x, email: undefined }));
            }}
          />
          <FieldError id="invite-email" message={errors.email} />
        </div>
      </div>
      {errors.form && (
        <p className={`${styles.notice} ${styles.noticeError} ${styles.formError}`} role="alert">
          {errors.form}
        </p>
      )}
      <div className={styles.inviteActions}>
        <button type="submit" className={styles.primaryButton} disabled={busy}>
          {busy ? "Sending…" : "Send invite"}
        </button>
        <button type="button" className={styles.linkButton} disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CodePanel({ issued, onDone }: { issued: IssuedCode; onDone: () => void }) {
  return (
    <div className={styles.codePanel} role="status">
      <p className={styles.codeLead}>
        {issued.why} The link went to <strong>{issued.email}</strong>. Their invite code:
      </p>
      <p className={styles.code}>{issued.code}</p>
      <p className={styles.codeHelp}>
        Give this code to the admin yourself. Don&apos;t send it in the same email or chat as the link. It is shown
        only now, and the link and code work for 24 hours. If it is lost, use Resend invite.
      </p>
      <button type="button" className={styles.primaryButton} onClick={onDone}>
        I&apos;ve noted the code
      </button>
    </div>
  );
}
