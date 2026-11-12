'use client'

// Not rendered on the profile page for now. Kept so it can be re-enabled by
// importing it back into page.tsx inside a settingCard.

import { useEffect, useState } from 'react';
import styles from '../page.module.css';
import { updateMyProfile, type UserProfile, type NotificationPrefs } from '@/util/api';
import PageLoader from '@/components/PageLoader/PageLoader';

const DEFAULT_NOTIF: NotificationPrefs = { order_updates: true, promotions: false, email_alerts: true };

const NOTIF_ITEMS: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
  { key: 'order_updates', label: 'Order updates', desc: 'Status changes for your active orders' },
  { key: 'promotions', label: 'Promotions', desc: 'Weekly deals and special offers' },
  { key: 'email_alerts', label: 'Email alerts', desc: 'Transaction receipts and account notices' },
];

export default function NotificationsPanel({ profile, onSaved }: { profile: UserProfile | null; onSaved: (p: UserProfile) => void }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIF);
  const [saving, setSaving] = useState<keyof NotificationPrefs | null>(null);

  useEffect(() => {
    if (profile) setPrefs({ ...DEFAULT_NOTIF, ...profile.notifications_preferences });
  }, [profile]);

  const toggle = async (key: keyof NotificationPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(key);
    try {
      onSaved(await updateMyProfile({ notifications_preferences: next }));
    } catch {
      setPrefs(prefs); // revert on failure
    } finally {
      setSaving(null);
    }
  };

  if (!profile) return <PageLoader variant="compact" />;

  return (
    <div className={styles.notifList}>
      {NOTIF_ITEMS.map(({ key, label, desc }) => (
        <div key={key} className={styles.notifRow}>
          <div className={styles.notifText}>
            <span className={styles.notifLabel}>{label}</span>
            <span className={styles.notifDesc}>{desc}</span>
          </div>
          <button
            type="button"
            className={`${styles.toggle} ${prefs[key] ? styles.toggleOn : ''}`}
            onClick={() => toggle(key)}
            disabled={saving === key}
            aria-label={`${prefs[key] ? 'Disable' : 'Enable'} ${label}`}
          >
            <span className={styles.toggleThumb} />
          </button>
        </div>
      ))}
    </div>
  );
}
