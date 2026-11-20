'use client'

// Account section: delete the account. The user types the current password
// (when the account has one), then the backend texts a code to the verified
// mobile number (POST /users/me/delete-code) and the delete must carry it. The
// backend checks both, so a session alone cannot delete the account.

import { useState } from 'react';
import styles from '../page.module.css';
import { deleteMyAccount, sendAccountDeleteCode } from '@/util/api';
import { hasPassword, signOut } from '@/lib/auth-client';

// idle: the button. password: type the password (or, with no password, confirm).
// code: type the texted code.
type Step = 'idle' | 'password' | 'code';

/** The backend's message: a string detail, or { message } for a refused delete (409). */
const apiErrorText = (err: unknown, fallback: string) => {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string') {
    return (detail as { message: string }).message;
  }
  return fallback;
};

export default function DeleteAccountPanel({ phoneVerified, onAddPhone }: {
  phoneVerified: boolean;
  onAddPhone: () => void;
}) {
  const [step, setStep] = useState<Step>('idle');
  // null until known; false for a Google/Facebook-only account.
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setStep('idle'); setPassword(''); setCode(''); setError(null); };

  const start = async () => {
    setBusy(true); setError(null);
    try {
      setNeedsPassword(await hasPassword());
      setStep('password');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.');
    } finally { setBusy(false); }
  };

  const sendCode = async () => {
    setBusy(true); setError(null);
    try {
      setSentTo(await sendAccountDeleteCode(needsPassword ? password : undefined));
      setStep('code');
    } catch (err) {
      setError(apiErrorText(err, 'We couldn\'t send the code. Try again.'));
    } finally { setBusy(false); }
  };

  const confirmDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await deleteMyAccount(code.trim());
      await signOut().catch(() => {});
      window.location.href = '/auth';
    } catch (err) {
      setError(apiErrorText(err, 'We couldn\'t delete your account. Try again.'));
      setBusy(false);
    }
  };

  if (!phoneVerified) {
    return (
      <div className={styles.rowList}>
        <div className={styles.notifRow}>
          <div className={styles.notifText}>
            <span className={styles.notifLabel}>Verify your mobile number first</span>
            <span className={styles.notifDesc}>
              To delete your account, we send a code to your mobile number.
            </span>
          </div>
          <button className={styles.outlineBtn} type="button" onClick={onAddPhone}>Go to Profile</button>
        </div>
      </div>
    );
  }

  if (step === 'idle') {
    return (
      <div className={styles.rowList}>
        <div className={styles.notifRow}>
          <div className={styles.notifText}>
            <span className={styles.notifLabel}>Delete your account</span>
            <span className={styles.notifDesc}>
              This permanently deletes your account, addresses and saved data. You cannot undo it.
            </span>
          </div>
          <button className={styles.dangerBtn} type="button" onClick={() => void start()} disabled={busy}>
            {busy ? 'Loading…' : 'Delete account'}
          </button>
        </div>
        {error && <p className={`${styles.panelError} ${styles.rowBanner}`} role="alert">{error}</p>}
      </div>
    );
  }

  if (step === 'password') {
    return (
      <form
        className={styles.dangerConfirm}
        onSubmit={(e) => { e.preventDefault(); void sendCode(); }}
      >
        <p className={styles.dangerWarning}>
          {needsPassword
            ? 'Type your current password. Then we send a code to your mobile number to delete your account.'
            : 'Are you sure? We will send a code to your mobile number. Type the code to delete your account.'}
        </p>
        {needsPassword && (
          <div className={styles.panelFormField}>
            <label htmlFor="delete-password" className={styles.formLabel}>Current password</label>
            <input
              id="delete-password"
              type="password"
              className={styles.formInput}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>
        )}
        {error && <p className={styles.panelError} role="alert">{error}</p>}
        <div className={styles.panelActions}>
          <button className={styles.dangerBtnSolid} type="submit" disabled={busy || (!!needsPassword && !password)}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
          <button className={styles.cancelBtn} type="button" onClick={reset} disabled={busy}>Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <form className={styles.dangerConfirm} onSubmit={(e) => void confirmDelete(e)}>
      <p className={styles.dangerWarning}>
        We sent a code to your number ending in {sentTo}. Type it to permanently delete your account.
      </p>
      <div className={styles.panelFormField}>
        <label htmlFor="delete-code" className={styles.formLabel}>Code</label>
        <input
          id="delete-code"
          className={`${styles.formInput} ${styles.codeInput}`}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          autoFocus
          required
        />
      </div>
      {error && <p className={styles.panelError} role="alert">{error}</p>}
      <div className={styles.panelActions}>
        <button className={styles.dangerBtnSolid} type="submit" disabled={busy || code.length < 6}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
        <button className={styles.linkBtn} type="button" onClick={() => void sendCode()} disabled={busy}>Send a new code</button>
        <button className={styles.cancelBtn} type="button" onClick={reset} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
