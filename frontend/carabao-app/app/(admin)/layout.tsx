import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import AdminShell from "./AdminShell";
import SignInAgainButton from "./SignInAgainButton";
import Link from "next/link";
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

  if (!session || session.user.role !== "admin") {
    redirect("/auth");
  }

  const twoFactorOn = Boolean((session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled);
  if (!twoFactorOn) {
    return (
      <div className={styles.gate}>
        <div className={styles.gateCard} role="alert">
          <h1>Two-step verification required</h1>
          <p>
            Admin accounts must use two-step verification with an authenticator app. Open the setup link that we sent
            to your verified mobile number and email. If the link expired, ask another admin to send a new one.
          </p>
          {/* Not "/": that sends an admin back here. */}
          <Link href="/order" className={styles.gateButton}>Back to Carabao</Link>
        </div>
      </div>
    );
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
