import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import PageHeader from "../../PageHeader";
import { NameForm, PasswordForm } from "./ProfileForms";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Profile" };

// The signed-in admin's own account: details, display name and password.
// Kept lean on purpose. There is no 2FA switch (admins cannot turn it off),
// no email change and no password reset (Admin creation.md sections 5–6).
// The admin layout has already checked role, 2FA and the code step.

const formatDate = (value: Date | string | null | undefined) =>
  value ? new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—";

export default async function AdminProfilePage() {
  const session = await auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
  if (!session) redirect("/admin/login");
  const user = session.user as typeof session.user & { twoFactorEnabled?: boolean | null };

  return (
    <div className={styles.page}>
      <PageHeader eyebrow="Account" title="Profile" description="Your admin account. Only you can change your name and password here." />

      <section className={styles.card} aria-labelledby="profile-details">
        <h2 id="profile-details" className={styles.cardTitle}>Account</h2>
        <dl className={styles.details}>
          <dt>Name</dt>
          <dd>{user.name || "—"}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd>Admin</dd>
          <dt>Two-step verification</dt>
          <dd>{user.twoFactorEnabled ? "On (authenticator app)" : "Not set up"}</dd>
          <dt>Account made</dt>
          <dd>{formatDate(user.createdAt)}</dd>
          <dt>This session started</dt>
          <dd>{formatDate(session.session.createdAt)}</dd>
        </dl>
        <p className={styles.note}>
          You cannot turn off two-step verification or change your email. If you lose your authenticator or forget
          your password, another admin uses <strong>Reset account</strong> on the Users page. You then get a new
          invite. If no admin can sign in, the operator recovers
          the account with <code>make_admin.py --recover</code>.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="profile-name">
        <h2 id="profile-name" className={styles.cardTitle}>Display name</h2>
        <NameForm initialName={user.name ?? ""} />
      </section>

      <section className={styles.card} aria-labelledby="profile-password">
        <h2 id="profile-password" className={styles.cardTitle}>Password</h2>
        <PasswordForm />
      </section>
    </div>
  );
}
