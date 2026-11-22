"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { changePassword, updateName } from "@/lib/auth-client";
import { ADMIN_PASSWORD_RULE_MESSAGE, isStrongAdminPassword } from "@/lib/password-policy";
import styles from "./page.module.css";

// The server checks the same rules (lib/auth.ts adminProfileGuard and
// passwordPolicy), so these checks only give a faster answer.

const NAME_MAX_LENGTH = 100;

const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export function NameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const clean = name.trim().replace(/\s+/g, " ");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (!clean) return setError("Enter your name.");
    setBusy(true);
    try {
      await updateName(clean);
      setSaved(clean);
      setName(clean);
      setDone("Your name is saved.");
      router.refresh(); // the sidebar shows the name from the session
    } catch (err) {
      setError(message(err, "We could not save your name."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <div className={styles.field}>
        <label htmlFor="profile-name-input">Name</label>
        <input
          id="profile-name-input"
          className={styles.input}
          value={name}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
        <span className={styles.hint}>Other admins see this name in the audit log and on the Users page.</span>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {done && <p className={styles.done} role="status">{done}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.primaryButton} disabled={busy || clean === saved}>
          {busy ? "Saving…" : "Save name"}
        </button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (!current) return setError("Enter your current password.");
    if (!isStrongAdminPassword(next)) return setError(ADMIN_PASSWORD_RULE_MESSAGE);
    if (next !== confirm) return setError("The new passwords are not the same.");
    if (next === current) return setError("The new password must be different from the current one.");
    setBusy(true);
    try {
      // Signs out your other sessions. Two-step verification does not change.
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone("Your password is changed. Your other sessions are signed out. Your authenticator does not change.");
    } catch (err) {
      setError(message(err, "We could not change your password."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <div className={styles.field}>
        <label htmlFor="pw-current">Current password</label>
        <input
          id="pw-current"
          type="password"
          className={styles.input}
          value={current}
          autoComplete="current-password"
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="pw-new">New password</label>
        <input
          id="pw-new"
          type="password"
          className={styles.input}
          value={next}
          autoComplete="new-password"
          onChange={(e) => setNext(e.target.value)}
        />
        <span className={styles.hint}>{ADMIN_PASSWORD_RULE_MESSAGE}</span>
      </div>
      <div className={styles.field}>
        <label htmlFor="pw-confirm">Type the new password again</label>
        <input
          id="pw-confirm"
          type="password"
          className={styles.input}
          value={confirm}
          autoComplete="new-password"
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {done && <p className={styles.done} role="status">{done}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.primaryButton} disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </div>
    </form>
  );
}
