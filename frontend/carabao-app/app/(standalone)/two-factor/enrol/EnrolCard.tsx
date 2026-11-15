"use client";

import TwoFactorSettings from "@/components/TwoFactorSettings/TwoFactorSettings";

/** Setup with the link's token (and the password, if the account has one);
 * when the backup codes are saved, open the admin area (a full load, so it
 * reads the new session). */
export default function EnrolCard({ token, needsPassword }: { token: string; needsPassword: boolean }) {
  return (
    <TwoFactorSettings
      enrolmentToken={token}
      needsPassword={needsPassword}
      onDone={() => window.location.assign("/admin/dashboard")}
    />
  );
}
