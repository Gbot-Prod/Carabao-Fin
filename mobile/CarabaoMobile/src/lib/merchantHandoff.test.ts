/// <reference types="node" />
// Run with `npm test`. Plan §3.3: the buyer app hands merchant work off to Carabao Merchant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MERCHANT_APP_URL, merchantAppPath, merchantWebUrl } from './merchantHandoff.ts';

test('the web page per kind, on the checked base', () => {
  assert.equal(merchantWebUrl('http://localhost:3000', 'dashboard'), 'http://localhost:3000/merchantDashboard');
  assert.equal(merchantWebUrl('https://carabao.ph/', 'onboarding'), 'https://carabao.ph/merchantOnboarding');
  // Trailing slashes on the base never double up.
  assert.equal(merchantWebUrl('https://carabao.ph///', 'dashboard'), 'https://carabao.ph/merchantDashboard');
});

test('the app opens on the dashboard or the onboarding form', () => {
  assert.equal(merchantAppPath('dashboard'), '/');
  assert.equal(merchantAppPath('onboarding'), '/onboarding');
  // The deep link is the scheme plus that path.
  assert.equal(MERCHANT_APP_URL, 'carabaomerchant://');
  assert.equal(MERCHANT_APP_URL + merchantAppPath('dashboard'), 'carabaomerchant:///');
});

test('a merchant notification opens the screen for its kind (plan §4.5)', () => {
  assert.equal(merchantAppPath('dashboard', 'new_order'), '/orders');
  assert.equal(merchantAppPath('dashboard', 'chat_message'), '/chats');
  assert.equal(merchantAppPath('dashboard', 'review_received'), '/reviews');
  // Payouts have no screen yet.
  assert.equal(merchantAppPath('dashboard', 'payout_released'), '/');
  assert.equal(merchantAppPath('dashboard', 'payout_destination_changed'), '/');
  // The kind comes from the server: anything else lands on the dashboard.
  assert.equal(merchantAppPath('dashboard', '../admin/refunds'), '/');
  assert.equal(merchantAppPath('dashboard', ''), '/');
  // Onboarding ignores it.
  assert.equal(merchantAppPath('onboarding', 'new_order'), '/onboarding');
});
