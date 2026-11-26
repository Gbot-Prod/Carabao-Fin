/// <reference types="node" />
// Run with `npm test`. CF-0132.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_NOTIFICATION_PREFS, NOTIFICATION_PREF_ITEMS, readNotificationPrefs, togglePrefs,
} from './notificationPrefs.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(repo, p), 'utf8').split('\r\n').join('\n');

test('CF-0132 missing or empty prefs give the web defaults', () => {
  for (const v of [null, undefined, {}, [], 'x', 3]) {
    assert.deepEqual(readNotificationPrefs(v), DEFAULT_NOTIFICATION_PREFS);
  }
});

test('CF-0132 stored bools win; non-bools and unknown keys are dropped', () => {
  assert.deepEqual(
    readNotificationPrefs({ order_updates: false, promotions: 'yes', email_alerts: 0, old_key: true }),
    { order_updates: false, promotions: false, email_alerts: true },
  );
});

test('CF-0132 toggle flips one key and sends only the three known keys', () => {
  const next = togglePrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...({ old_key: true } as object) }, 'order_updates');
  assert.deepEqual(next, { order_updates: false, promotions: false, email_alerts: true });
  assert.deepEqual(Object.keys(next).sort(), ['email_alerts', 'order_updates', 'promotions']);
});

test('CF-0132 keys and defaults stay in step with the backend schema and the web panel', () => {
  const schema = read('backend/app/schemas/user.py');
  const block = schema.slice(schema.indexOf('class NotificationPreferences'), schema.indexOf('class UserUpdate'));
  const backendKeys = [...block.matchAll(/^\s+(\w+): StrictBool/gm)].map((m) => m[1]).sort();
  // promotions is stored but not shown (nothing sends promotions).
  assert.deepEqual(NOTIFICATION_PREF_ITEMS.map((i) => i.key).sort(), backendKeys.filter((k) => k !== 'promotions'));
  const web = read('frontend/carabao-app/app/(site)/(app)/profile/components/NotificationsPanel.tsx');
  assert.match(web, /DEFAULT_NOTIF: NotificationPrefs = \{ order_updates: true, promotions: false, email_alerts: true \}/);
  for (const { label, desc } of NOTIFICATION_PREF_ITEMS) {
    assert.ok(web.includes(`label: '${label}', desc: '${desc}'`), label);
  }
});
