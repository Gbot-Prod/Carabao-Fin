import type { Metadata } from "next";
import AcceptInviteForm from "./AcceptInviteForm";
import "@/app/(site)/(standalone)/auth/page.css";

// The link carries a one-time token: do not send it to other sites.
export const metadata: Metadata = { title: "Accept your admin invite", referrer: "no-referrer" };

/**
 * DB_ROLE_SPLIT_PLAN.md section 2, step 2: the page the admin invite email
 * opens. No session is needed. The invitee enters the code the inviting admin
 * gave them and a new password; the API checks the link's token and the code
 * and writes the password (POST /admin/invites/accept). Then they sign in and
 * set up their authenticator with the same link's token.
 */
export default async function AdminInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string | string[]; token?: string | string[] }>;
}) {
  const { invite: rawInvite, token: rawToken } = await searchParams;
  const invite = typeof rawInvite === "string" ? rawInvite : "";
  const token = typeof rawToken === "string" ? rawToken : "";

  return (
    <div className="auth-page auth-page--single">
      <section className="auth-form-panel">
        <div className="auth-form-shell">
          <div className="auth-header">
            <p className="auth-kicker">Carabao admin</p>
            <h2>Accept your invite</h2>
          </div>
          {invite && token ? (
            <AcceptInviteForm invite={invite} token={token} />
          ) : (
            <div className="auth-error" role="alert">
              This link is not complete. Open the full link from the invite email again.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
