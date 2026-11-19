'use client'

// Account section: change the password, or add one when the account has none
// (Google/Facebook sign-in only). The form opens from a button, like the
// delete step. The rule is lib/password-policy.ts; the
// server checks it too.

import { useEffect, useState } from 'react';
import styles from '../page.module.css';
import PageLoader from '@/components/PageLoader/PageLoader';
import { addPassword, changePassword, hasPassword } from '@/lib/auth-client';
import { PASSWORD_RULE_MESSAGE, isStrongPassword } from '@/lib/password-policy';

export default function PasswordPanel() {
  const [has, setHas] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    hasPassword()
      .then(setHas)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'We couldn\'t load your sign-in methods.'));
  }, []);

  if (loadError) return <p className={styles.panelError}>{loadError}</p>;
  if (has === null) return <PageLoader variant="compact" />;

  const close = () => { setOpen(false); setCurrent(''); setNext(''); setConfirm(''); setError(null); };

  if (!open) {
    return (
      <div className={styles.panelForm}>
        <p className={styles.panelHint}>
          {has
            ? 'Change the password you use to log in with your number or email.'
            : 'Your account has no password. You log in with Google or Facebook. Add a password to also log in with your number or email.'}
        </p>
        {done && <p className={styles.noticeBanner} role="status">{done}</p>}
        <div className={styles.panelActions}>
          <button className={styles.secondaryBtn} type="button" onClick={() => { setDone(null); setOpen(true); }}>
            {has ? 'Change password' : 'Add password'}
          </button>
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setDone(null);
    if (!isStrongPassword(next)) { setError(PASSWORD_RULE_MESSAGE); return; }
    if (next !== confirm) { setError('The new passwords are not the same.'); return; }
    setBusy(true);
    try {
      if (has) {
        await changePassword(current, next);
        setDone('Your password is changed. We logged out your other devices.');
      } else {
        await addPassword(next);
        setHas(true);
        setDone('Your password is added. You can now log in with it.');
      }
      close();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to save. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <form className={styles.panelForm} onSubmit={(e) => void submit(e)}>
      {has && (
        <div className={styles.panelFormField}>
          <label htmlFor="pw-current" className={styles.formLabel}>Current password</label>
          <input id="pw-current" type="password" className={styles.formInput} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus required />
        </div>
      )}
      <div className={styles.panelFormField}>
        <label htmlFor="pw-new" className={styles.formLabel}>New password</label>
        <input id="pw-new" type="password" className={styles.formInput} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" autoFocus={!has} required />
        <span className={styles.formHint}>{PASSWORD_RULE_MESSAGE}</span>
      </div>
      <div className={styles.panelFormField}>
        <label htmlFor="pw-confirm" className={styles.formLabel}>Type the new password again</label>
        <input id="pw-confirm" type="password" className={styles.formInput} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </div>
      {error && <p className={styles.panelError} role="alert">{error}</p>}
      <div className={styles.panelActions}>
        <button className={styles.primaryBtn} type="submit" disabled={busy}>
          {busy ? 'Saving…' : has ? 'Save new password' : 'Add password'}
        </button>
        <button className={styles.cancelBtn} type="button" onClick={close} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
