"use client";

import { useState, type FormEvent } from "react";
import { acceptAdminInvite } from "@/util/api/admin";
import { getApiErrorDetail, getApiErrorStatus } from "@/util/errorHelper";
import FieldError, { focusFirstInvalid, invalidClass, invalidProps, type FieldErrors } from "@/components/FieldError/FieldError";

// Keep in step with backend app/services/admin_accounts.py admin_password_ok:
// the site's password rule (lib/password-policy.ts) at 12+ characters.
const MIN_ADMIN_PASSWORD = 12;
const MAX_PASSWORD = 128;
const ADMIN_PASSWORD_RULE =
  "Use 12 to 128 characters, with an uppercase letter, a lowercase letter, a number and a symbol.";

const adminPasswordOk = (p: string) =>
  p.length >= MIN_ADMIN_PASSWORD &&
  p.length <= MAX_PASSWORD &&
  /\p{Lu}/u.test(p) &&
  /\p{Ll}/u.test(p) &&
  /\p{Nd}/u.test(p) &&
  /[^\p{L}\p{N}\s]/u.test(p);

type Field = "code" | "password" | "confirm";

export default function AcceptInviteForm({ invite, token }: { invite: string; token: string }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const clear = (field: Field) => {
    if (errors[field]) setErrors((x) => ({ ...x, [field]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError("");
    const next: FieldErrors<Field> = {};
    if (code.replace(/[\s-]/g, "").length !== 8) next.code = "Enter the 8-character code the admin who invited you gave you.";
    if (!adminPasswordOk(password)) next.password = ADMIN_PASSWORD_RULE;
    if (confirm !== password) next.confirm = "The passwords are not the same.";
    setErrors(next);
    if (Object.values(next).some(Boolean)) {
      requestAnimationFrame(focusFirstInvalid);
      return;
    }
    setBusy(true);
    try {
      const { email } = await acceptAdminInvite({ invite, token, code, password });
      // Sign in, then set up the authenticator with this link's token.
      const next = `/two-factor/enrol?token=${encodeURIComponent(token)}`;
      const params = new URLSearchParams({ next, email });
      window.location.assign(`/admin/login?${params.toString()}`);
    } catch (err) {
      const status = getApiErrorStatus(err);
      const detail = getApiErrorDetail(err);
      if (status === 422 && detail) {
        setErrors({ password: detail });
        requestAnimationFrame(focusFirstInvalid);
      } else {
        // The API never says which part was wrong (link or code).
        setFormError(detail || "Could not accept the invite. Try again.");
      }
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <p className="auth-help">
        Enter the invite code that the admin who invited you gave you. It is not in the email. Then choose a password for
        your admin account.
      </p>
      <div className="auth-fields">
        {formError && (
          <div className="auth-error" role="alert">
            {formError}
          </div>
        )}
        <div className={invalidClass(errors.code).trim() || undefined}>
          <input
            id="invite-code"
            className="auth-input"
            aria-label="Invite code"
            placeholder="Invite code (XXXX-XXXX)"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            autoFocus
            value={code}
            {...invalidProps("invite-code", errors.code)}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              clear("code");
            }}
          />
          <FieldError id="invite-code" message={errors.code} />
        </div>
        <div className={invalidClass(errors.password).trim() || undefined}>
          <input
            id="invite-password"
            className="auth-input"
            type="password"
            aria-label="New password"
            placeholder="New password (12+ characters)"
            autoComplete="new-password"
            maxLength={MAX_PASSWORD}
            value={password}
            {...invalidProps("invite-password", errors.password)}
            onChange={(e) => {
              setPassword(e.target.value);
              clear("password");
            }}
          />
          <FieldError id="invite-password" message={errors.password} />
        </div>
        <div className={invalidClass(errors.confirm).trim() || undefined}>
          <input
            id="invite-confirm"
            className="auth-input"
            type="password"
            aria-label="New password again"
            placeholder="New password again"
            autoComplete="new-password"
            maxLength={MAX_PASSWORD}
            value={confirm}
            {...invalidProps("invite-confirm", errors.confirm)}
            onChange={(e) => {
              setConfirm(e.target.value);
              clear("confirm");
            }}
          />
          <FieldError id="invite-confirm" message={errors.confirm} />
        </div>
      </div>
      <button type="submit" className="auth-submit" disabled={busy}>
        {busy ? "Please wait…" : "Accept invite"}
      </button>
    </form>
  );
}
