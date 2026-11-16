"use client";

import { useState } from "react";
import { signOut } from "@/lib/auth-client";
import { signInPath } from "@/lib/urls";

/**
 * Sign out, then open the sign-in page. Used for a session that did not pass
 * the code step (CF-0017), and for an admin setup link opened in another
 * account (`next` returns to the link after sign-in).
 */
export default function SignInAgainButton({
  className,
  next,
  label = "Sign out and sign in again",
}: {
  className?: string;
  next?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    await signOut().catch(() => {});
    window.location.assign(signInPath(next));
  };
  return (
    <button type="button" className={className} disabled={busy} onClick={() => void run()}>
      {label}
    </button>
  );
}
