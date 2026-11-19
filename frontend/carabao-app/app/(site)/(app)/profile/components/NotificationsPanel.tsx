'use client'

// Notification switches in the profile page's Settings section.
// The backend reads order_updates (SMS) and email_alerts (email); promotions
// is saved but nothing sends promotions yet.

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
    // CF-0054: only the known keys; the API refuses others (an old stored
    // key would otherwise be sent back with every toggle).
    const next: NotificationPrefs = {
      order_updates: prefs.order_updates,
      promotions: prefs.promotions,
      email_alerts: prefs.email_alerts,
      [key]: !prefs[key],
    };
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
            role="switch"
            aria-checked={prefs[key]}
            className={`${styles.toggle} ${prefs[key] ? styles.toggleOn : ''}`}
            onClick={() => toggle(key)}
            disabled={saving === key}
            aria-label={label}
          >
            <span className={styles.toggleThumb} />
          </button>
        </div>
      ))}
    </div>
  );
}
