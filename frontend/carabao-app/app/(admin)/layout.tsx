import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import AdminSidebar from "./AdminSidebar";
import Link from "next/link";
import styles from "./layout.module.css";

// E8c: same switch as the backend's ADMIN_REQUIRE_2FA (default on).
const requireTwoFactor = (process.env.ADMIN_REQUIRE_2FA ?? "true").toLowerCase() !== "false";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const reqHeaders = await headers();
  // Uncached, so turning on two-step verification takes effect at once (E8c).
  const session = await auth.api.getSession({ headers: reqHeaders, query: { disableCookieCache: true } });

  if (!session || session.user.role !== "admin") {
    redirect("/auth");
  }

  const twoFactorOn = Boolean((session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled);
  if (requireTwoFactor && !twoFactorOn) {
    return (
      <div className={styles.gate}>
        <div className={styles.gateCard} role="alert">
          <h1>Two-step verification required</h1>
          <p>
            Admin accounts must use two-step verification. Turn it on in the Security section of your profile
            with an authenticator app, then come back here.
          </p>
          <Link href="/profile" className={styles.gateButton}>Go to my profile</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <AdminSidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
