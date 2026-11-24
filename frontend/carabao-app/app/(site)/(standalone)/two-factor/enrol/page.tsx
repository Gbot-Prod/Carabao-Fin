import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { enrolmentLinkState, hashEnrolmentToken } from "@/lib/admin-two-factor";
import SignInAgainButton from "@/app/(site)/(admin)/SignInAgainButton";
import EnrolCard from "./EnrolCard";
import { signInPath } from "@/lib/urls";
import "../../auth/page.css";

// The link carries a one-time token: do not send it to other sites.
export const metadata: Metadata = { title: "Set up two-step verification", referrer: "no-referrer" };

/**
 * CF-0018: the page that the admin setup link opens. Setup needs the signed-in
 * admin and the token from the link; lib/auth.ts checks the token again on
 * /two-factor/enable. This page checks it first, to say what is wrong.
 */
export default async function TwoFactorEnrolPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token: raw } = await searchParams;
  const token = typeof raw === "string" ? raw : "";
  const linkPath = `/two-factor/enrol?token=${encodeURIComponent(token)}`;
  const session = await auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
  const user = session?.user as { id: string; role?: string | null; twoFactorEnabled?: boolean | null } | undefined;

  let body: React.ReactNode;
  if (!token) {
    // The admin layout sends an admin without 2FA here. Setup needs the
    // invite or reset link's token, so there is nothing else to offer.
    body = (
      <>
        <div className="auth-error" role="alert">
          Use the link from your invite email. If it expired, ask another admin to reset your account.
        </div>
        {user && <SignInAgainButton className="auth-link auth-link--button" label="Sign out" />}
      </>
    );
  } else if (!user) {
    // Sign-in brings the admin back here with the token.
    redirect(signInPath(linkPath));
  } else {
    const ctx = await auth.$context;
    const row = await ctx.adapter.findOne<{ identifier: string; expiresAt: Date }>({
      model: "verification",
      where: [{ field: "value", value: hashEnrolmentToken(token) }],
    });
    const state = enrolmentLinkState(row, user.id);

    if (state === "other-account") {
      body = (
        <>
          <div className="auth-error" role="alert">
            This link is for a different account than the one you are signed in to.
          </div>
          <p className="auth-help">Sign out, then sign in with the account that got the link.</p>
          <SignInAgainButton className="auth-link auth-link--button" next={linkPath} label="Sign out and switch account" />
        </>
      );
    } else if (state === "replaced") {
      body = user.twoFactorEnabled ? (
        <>
          <p className="auth-help">Two-step verification is already on for this account. This link was used.</p>
          <Link href="/admin/dashboard" className="auth-link">Open the admin area</Link>
        </>
      ) : (
        <div className="auth-error" role="alert">
          A newer link replaced this one. Open the newest link from your email. If you do not have it, ask another admin
          to reset your account.
        </div>
      );
    } else if (state === "expired") {
      body = (
        <div className="auth-error" role="alert">
          This link expired. Links work for 24 hours. Ask another admin to reset your account.
        </div>
      );
    } else if (user.role !== "admin") {
      body = (
        <div className="auth-error" role="alert">
          This account is no longer an admin account.
        </div>
      );
    } else {
      // Same rule as BetterAuth's shouldRequirePassword (allowPasswordless).
      const accounts = await ctx.internalAdapter.findAccounts(user.id);
      const needsPassword = accounts.some((a) => a.providerId === "credential" && Boolean(a.password));
      body = <EnrolCard token={token} needsPassword={needsPassword} />;
    }
  }

  return (
    <div className="auth-page auth-page--single">
      <section className="auth-form-panel">
        <div className="auth-form-shell">
          <div className="auth-header">
            <p className="auth-kicker">Carabao admin</p>
            <h2>Set up two-step verification</h2>
          </div>
          {body}
        </div>
      </section>
    </div>
  );
}
