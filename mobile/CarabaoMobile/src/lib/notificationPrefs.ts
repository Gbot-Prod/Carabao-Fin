// CF-0132: the buyer's notification switches, saved on the server
// (PATCH /users/me { notifications_preferences }). Port of the logic in web
// frontend/carabao-app/app/(site)/(app)/profile/components/NotificationsPanel.tsx:
// same defaults, same keys. The backend reads order_updates (SMS) and
// email_alerts (email). promotions is kept in the data but not shown: nothing sends it.
// PATCH replaces the whole stored object and refuses unknown keys
// (schemas/user.py NotificationPreferences, extra="forbid"), so every save
// sends exactly the three known keys.
export type NotificationPrefs = {
  order_updates: boolean;
  promotions: boolean;
  email_alerts: boolean;
};

export type NotificationPrefKey = keyof NotificationPrefs;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  order_updates: true,
  promotions: false,
  email_alerts: true,
};

export const NOTIFICATION_PREF_ITEMS: { key: NotificationPrefKey; label: string; desc: string }[] = [
  { key: 'order_updates', label: 'Order updates', desc: 'Status changes for your active orders' },
  { key: 'email_alerts', label: 'Email alerts', desc: 'Transaction receipts and account notices' },
];

/** The stored value with defaults filled in. Non-bool values and unknown keys are ignored. */
export function readNotificationPrefs(stored: unknown): NotificationPrefs {
  const out: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS };
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const s = stored as Record<string, unknown>;
    for (const { key } of NOTIFICATION_PREF_ITEMS) {
      if (typeof s[key] === 'boolean') out[key] = s[key] as boolean;
    }
  }
  return out;
}

/** The body for one switch flip: only the three known keys, `key` turned over. */
export function togglePrefs(prefs: NotificationPrefs, key: NotificationPrefKey): NotificationPrefs {
  return {
    order_updates: prefs.order_updates,
    promotions: prefs.promotions,
    email_alerts: prefs.email_alerts,
    [key]: !prefs[key],
  };
}
