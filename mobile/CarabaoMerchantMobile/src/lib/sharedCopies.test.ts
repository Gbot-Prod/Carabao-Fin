/// <reference types="node" />
// Run with `npm test`. Plan §4.6 of MOBILE_MERCHANT_SPLIT_PLAN.md: this app must not fork shared
// code by accident. Every file both apps need (plan §2.3) is copied from mobile/CarabaoMobile
// with one line on top:
//
//   // Shared with mobile/CarabaoMobile/src/lib/theme.ts. Keep both copies the same (sharedCopies.test.ts).
//
// Drop that line and the two copies must be identical. So a change in the buyer app that is meant
// for both apps has to be copied over here, and a merchant-only change shows up as a failing test
// instead of a silent fork.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..', '..');
// src/lib -> mobile/CarabaoMerchantMobile -> mobile/CarabaoMobile
const buyerApp = join(here, '..', '..', '..', 'CarabaoMobile');
const buyerMissing = existsSync(buyerApp) ? false : 'mobile/CarabaoMobile is not next to this app';

/** Files both apps share byte for byte, once the marker line is dropped (plan §2.3). */
const SHARED = [
  'hooks/use-color-scheme.ts',
  'hooks/use-color-scheme.web.ts',
  'src/components/AddEmailSheet.tsx',
  'src/components/PasswordResetSheet.tsx',
  'src/components/PhoneVerifySheet.tsx',
  'src/components/Skeleton.tsx',
  'src/components/UI.tsx',
  'src/lib/apiErrors.ts',
  'src/lib/apiErrors.test.ts',
  'src/lib/baseUrl.ts',
  'src/lib/baseUrl.test.ts',
  'src/lib/config.ts',
  'src/lib/idle.ts',
  'src/lib/idle.test.ts',
  'src/lib/imageUri.ts',
  'src/lib/imageUri.test.ts',
  'src/lib/inputLimits.ts',
  'src/lib/inputLimits.test.ts',
  'src/lib/livePolling.ts',
  'src/lib/livePolling.test.ts',
  'src/lib/logGuard.test.ts',
  'src/lib/notificationList.ts',
  'src/lib/notificationPrefs.ts',
  'src/lib/notificationPrefs.test.ts',
  'src/lib/orderStatus.ts',
  'src/lib/orderStatus.test.ts',
  'src/lib/passwordPolicy.ts',
  'src/lib/passwordPolicy.test.ts',
  'src/lib/phone.ts',
  'src/lib/phone.test.ts',
  'src/lib/polling.ts',
  'src/lib/polling.test.ts',
  'src/lib/sessionEvents.ts',
  'src/lib/theme.ts',
  'src/lib/usePolling.ts',
  'src/lib/webPages.ts',
];

// Copied by hand with one buyer-only test removed, so they cannot be compared here (the header of
// each file says what was left out):
//  - src/lib/notificationList.test.ts: its M50 test checks the buyer notificationLinks routes; the
//    merchant app maps notification links of its own in S12.
//  - src/lib/webPages.test.ts: its last test reads the buyer src/screens/ProfileScreen.tsx, which
//    this app does not have.
const COPIED_BY_HAND = ['src/lib/notificationList.test.ts', 'src/lib/webPages.test.ts'];

const markerFor = (path: string) =>
  `// Shared with mobile/CarabaoMobile/${path}. Keep both copies the same (sharedCopies.test.ts).`;

/** LF-only, so a CRLF checkout of one app cannot fail the comparison. */
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const localPath = (path: string) => join(app, ...path.split('/'));

test('every shared copy matches the buyer app', { skip: buyerMissing }, () => {
  const problems: string[] = [];
  for (const path of SHARED) {
    const copy = localPath(path);
    if (!existsSync(copy)) {
      problems.push(`${path}: no copy in this app - create it, or take it out of SHARED`);
      continue;
    }
    const text = read(copy);
    if (text.slice(0, text.indexOf('\n')) !== markerFor(path)) {
      problems.push(`${path}: line 1 is not the shared-copy marker`);
    }
    if (text.slice(text.indexOf('\n') + 1) !== read(join(buyerApp, ...path.split('/')))) {
      problems.push(`${path}: differs from mobile/CarabaoMobile/${path}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the copies that carry a buyer-only test are still here', () => {
  for (const path of COPIED_BY_HAND) {
    const copy = localPath(path);
    assert.ok(existsSync(copy), `${path} is missing`);
    assert.match(read(copy), /^\/\/ Merchant copy of mobile\/CarabaoMobile\//, `${path} keeps its header`);
  }
});
