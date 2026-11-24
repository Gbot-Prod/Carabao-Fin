// S16: the Store settings rules (src/lib/storeSettings.ts), case for case from the web merchant
// forms they were copied from. `npm test`.
/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKER_LABELS,
  codeComplete,
  codeInput,
  DAYS,
  daysProblem,
  DEFAULT_PAUSE_DAYS,
  daysText,
  deliveryFeeProblem,
  formatLocalPhone,
  localPhoneFromStored,
  MAX_DELIVERY_PRICE,
  PAUSE_MESSAGE_MAX,
  areaText,
  pinText,
  readDeleteError,
  settingsFieldErrors,
  streetText,
} from './storeSettings.ts';

test('the week runs Monday first, as the backend Weekday literal and the web DAYS', () => {
  assert.deepEqual([...DAYS], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.equal(DEFAULT_PAUSE_DAYS, 7);
  assert.equal(MAX_DELIVERY_PRICE, 100_000);
  assert.equal(PAUSE_MESSAGE_MAX, 200);
});

test('formatLocalPhone groups the local digits three-three-four and drops the rest', () => {
  assert.equal(formatLocalPhone('9171234567'), '917 123 4567');
  assert.equal(formatLocalPhone('917'), '917');
  assert.equal(formatLocalPhone('917123'), '917 123');
  assert.equal(formatLocalPhone('917123456789'), '917 123 4567');
  assert.equal(formatLocalPhone('0917 123 4567'), '091 712 3456');
  assert.equal(formatLocalPhone(''), '');
});

test('the phone box strips the +63 of a stored number', () => {
  assert.equal(localPhoneFromStored('+639171234567'), '917 123 4567');
  assert.equal(localPhoneFromStored('+63 917 123 4567'), '917 123 4567');
  assert.equal(localPhoneFromStored(null), '');
});

test('daysText lists the days in week order, whatever order the API sends', () => {
  assert.equal(daysText(['Fri', 'Mon', 'Wed']), 'Mon, Wed, Fri');
  assert.equal(daysText(['Sun']), 'Sun');
  assert.equal(daysText([]), '');
  assert.equal(daysText(null), '');
});

test('a blank delivery fee means no fee; whole pesos from 0 to 100,000 only', () => {
  assert.equal(deliveryFeeProblem(''), null);
  assert.equal(deliveryFeeProblem('  '), null);
  assert.equal(deliveryFeeProblem('0'), null);
  assert.equal(deliveryFeeProblem('80'), null);
  assert.equal(deliveryFeeProblem('100000'), null);
  assert.match(deliveryFeeProblem('80.50') ?? '', /whole pesos/);
  assert.match(deliveryFeeProblem('-1') ?? '', /whole pesos/);
  assert.match(deliveryFeeProblem('100001') ?? '', /whole pesos/);
  assert.match(deliveryFeeProblem('eighty') ?? '', /whole pesos/);
});

test('at least one operating day is required', () => {
  assert.equal(daysProblem(['Mon']), null);
  assert.equal(daysProblem([]), 'Select at least one operating day.');
});

test('the code box keeps six digits; six digits are complete', () => {
  assert.equal(codeInput('12ab34 5678'), '123456');
  assert.equal(codeInput('12345'), '12345');
  assert.equal(codeComplete('123456'), true);
  assert.equal(codeComplete('12345'), false);
  assert.equal(codeComplete('12345a'), false);
});

test('a 409 delete is read as its message plus the open items', () => {
  const err = {
    status: 409,
    message: 'Settle active orders',
    detail: {
      message: 'Settle active orders, refunds and payouts before deleting your merchant profile',
      blockers: { active_orders: 2, open_payouts: 1 },
    },
  };
  assert.deepEqual(readDeleteError(err, 'fallback'), {
    message: 'Settle active orders, refunds and payouts before deleting your merchant profile',
    items: [BLOCKER_LABELS.active_orders(2), BLOCKER_LABELS.open_payouts(1)],
  });
});

test('an unknown blocker key still reads as words, and a missing message is replaced', () => {
  const out = readDeleteError(
    { status: 409, detail: { blockers: { something_new: 3 } } },
    'fallback',
  );
  assert.equal(out.message, "Your shop can't be deleted yet.");
  assert.deepEqual(out.items, ['something new: 3']);
});

test('other errors keep the server words, or the fallback when it has none', () => {
  assert.deepEqual(readDeleteError({ status: 400, message: 'Wrong password' }, 'fallback'), {
    message: 'Wrong password',
    items: [],
  });
  assert.deepEqual(readDeleteError(null, 'fallback'), { message: 'fallback', items: [] });
});

test('the summary lines read like the web read view', () => {
  const merchant = {
    barangay: 'Poblacion', city: 'Baguio City', province: 'Benguet', region: 'CAR',
    address: '123 Rizal St.', postal_code: '2600', lat: 16.4023, lng: 120.596,
    pin_confirmed: true,
  };
  assert.equal(areaText(merchant), 'Poblacion, Baguio City, Benguet, CAR');
  assert.equal(streetText(merchant), '123 Rizal St. · 2600');
  assert.equal(pinText(merchant), 'Pin: 16.40230, 120.59600');
  assert.equal(pinText({ ...merchant, pin_confirmed: false }), 'Pin: 16.40230, 120.59600 (not confirmed)');
  assert.equal(pinText({ ...merchant, lat: null }), 'Pin: not pinned');
  assert.equal(areaText({ barangay: null, city: null, province: null, region: null }), '');
});

test('only the field messages the form shows are kept', () => {
  assert.deepEqual(
    settingsFieldErrors({ region: 'Not in Luzon', delivery_price: 'Too high', pin: 'Move it' }),
    { region: 'Not in Luzon', pin: 'Move it' },
  );
  assert.deepEqual(settingsFieldErrors({}), {});
});
