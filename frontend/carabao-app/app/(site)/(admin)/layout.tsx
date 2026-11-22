import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import AdminShell from "./AdminShell";
import SignInAgainButton from "./SignInAgainButton";
import styles from "./layout.module.css";

// E8c / CF-0003: admins always need two-step verification, as the backend's
// admin API does. There is no switch for it.
// CF-0017: this session must also have passed the code step. A Google sign-in
// goes through it too (lib/auth.ts), but a session from before 2FA was on,
// or from before this rule, did not.

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const reqHeaders = await headers();
  // Uncached, so turning on two-step verification takes effect at once (E8c).
  const session = await auth.api.getSession({ headers: reqHeaders, query: { disableCookieCache: true } });

  // admin.<root> has its own sign-in page and cookies (lib/auth.ts): a session
  // from the public site is not seen here at all.
  if (!session) {
    redirect("/admin/login");
  }

  // The admin deploy gives sessions only to admins; this is a second check.
  if (session.user.role !== "admin") {
    return (
      <div className={styles.gate}>
        <div className={styles.gateCard} role="alert">
          <h1>Not an admin account</h1>
          <p>This account cannot use the admin area. Sign in with an admin account.</p>
          <SignInAgainButton className={styles.gateButton} label="Sign out" />
        </div>
      </div>
    );
  }

  // A new admin, or one whose 2FA was reset: set it up first. Setup still
  // needs the one-time token from the invite or reset link (lib/auth.ts), so
  // the enrol page without one only says to use that link. Every other admin
  // route stays closed, and the admin API refuses tokens without mfa.
  const twoFactorOn = Boolean((session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled);
  if (!twoFactorOn) {
    redirect("/two-factor/enrol");
  }

  const passedCodeStep = (session.session as { mfaVerified?: boolean | null }).mfaVerified === true;
  if (!passedCodeStep) {
    return (
      <div className={styles.gate}>
        <div className={styles.gateCard} role="alert">
          <h1>Sign in again</h1>
          <p>
            This session did not ask for your authenticator code. Sign in again and enter the code to use the admin
            area.
          </p>
          <SignInAgainButton className={styles.gateButton} />
        </div>
      </div>
    );
  }

  return (
    <AdminShell user={{ name: session.user.name ?? "", email: session.user.email ?? "" }}>
      {children}
    </AdminShell>
  );
}
