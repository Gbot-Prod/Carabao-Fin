/// <reference types="node" />
// Run with `npm test`. CF-0110.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ADDRESS_LIMITS, addressLine, addressSummary, checkAddress, deliveryFields, type SavedAddress } from './addresses.ts';

const home: SavedAddress = {
  id: 3, label: 'Home', region: 'NCR', province: 'Metro Manila', city: 'Marikina', barangay: 'San Roque',
  address: '12 Rizal St', postal_code: '1800', lat: 14.63, lng: 121.1, is_default: true,
};
const fields = { label: 'Home', address: ' 12 Rizal St ', barangay: '', city: 'Marikina', province: 'Metro Manila', postal_code: '1800' };

test('delivery line = web checkout order of parts, empty parts left out', () => {
  assert.equal(addressLine(home), '12 Rizal St, San Roque, Marikina, Metro Manila, 1800, Philippines');
  assert.equal(addressLine({ ...home, barangay: null, postal_code: ' ' }), '12 Rizal St, Marikina, Metro Manila, Philippines');
  assert.equal(addressSummary(home), 'Home · 12 Rizal St · Marikina');
  assert.equal(addressSummary({ ...home, label: null, address: null, city: null }), 'Address #3');
});

test('a good form is trimmed, blanks become null', () => {
  assert.deepEqual(checkAddress(fields), {
    ok: { label: 'Home', address: '12 Rizal St', barangay: null, city: 'Marikina', province: 'Metro Manila', postal_code: '1800' },
  });
});

test('street, city and province are needed; bounds and postal code are checked', () => {
  const err = (over: Partial<typeof fields>) => {
    const r = checkAddress({ ...fields, ...over });
    return 'error' in r ? r.error : null;
  };
  assert.match(err({ address: '' })!, /street/);
  assert.match(err({ city: ' ' })!, /city/);
  assert.match(err({ province: '' })!, /province/);
  assert.match(err({ address: 'x'.repeat(256) })!, /at most 255/);
  assert.match(err({ label: 'x'.repeat(51) })!, /at most 50/);
  assert.match(err({ postal_code: '18000' })!, /4 digits/);
  assert.equal(err({ postal_code: '' }), null);
});

test('a saved address sends its region and pin; changed text sends text only', () => {
  assert.deepEqual(deliveryFields(home, addressLine(home)), {
    delivery_address: addressLine(home), delivery_region: 'NCR', delivery_lat: 14.63, delivery_lng: 121.1,
  });
  assert.deepEqual(deliveryFields(home, `${addressLine(home)} gate 2`), { delivery_address: `${addressLine(home)} gate 2` });
  assert.deepEqual(deliveryFields(null, '  '), { delivery_address: null });
  assert.deepEqual(deliveryFields({ ...home, region: null, lat: null }, addressLine(home)), { delivery_address: addressLine(home) });
});

test('limits = backend schemas/user_address.py', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const py = readFileSync(join(repo, 'backend/app/schemas/user_address.py'), 'utf8');
  for (const [k, max] of Object.entries(ADDRESS_LIMITS)) {
    assert.match(py, new RegExp(`${k}: str \\| None = Field\\(default=None, max_length=${max}\\)`), k);
  }
});
