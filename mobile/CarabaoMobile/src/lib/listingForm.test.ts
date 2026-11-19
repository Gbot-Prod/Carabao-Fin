/// <reference types="node" />
// Run with `npm test`. CF-0107.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  addDays, checkListing, freshnessError, LISTING_NAME_MAX, LISTING_PRICE_MAX, LISTING_STOCK_MAX, parseYmd, phToday,
} from './listingForm.ts';

const ok = { name: 'Kale', price: '120', stock: '5', harvestDate: '2026-11-18', bestBefore: '2026-11-25' };
const today = '2026-11-19';

test('Philippine "today" changes at 16:00 UTC', () => {
  assert.equal(phToday(new Date('2026-11-19T15:59:59Z')), '2026-11-19');
  assert.equal(phToday(new Date('2026-11-19T16:00:00Z')), '2026-11-20');
});

test('dates: only real YYYY-MM-DD; adding days crosses months and years', () => {
  assert.equal(parseYmd(' 2026-11-19 '), '2026-11-19');
  for (const bad of ['2026-02-30', '2026-13-01', '19/11/2026', '2026-1-9', '', 'today']) {
    assert.equal(parseYmd(bad), null, bad);
  }
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('freshness: same messages and order as backend freshness_error', () => {
  assert.equal(freshnessError(null, '2026-11-20', today), 'Harvest date and best-before date are required');
  assert.equal(freshnessError('2026-11-20', '2026-11-25', today), 'Harvest date cannot be in the future');
  assert.equal(freshnessError('2026-11-18', '2026-11-17', today), 'Best-before date cannot be earlier than the harvest date');
  assert.equal(freshnessError('2026-11-19', '2026-11-19', today), null); // same day is allowed
});

test('a good form gives the payload with both dates', () => {
  assert.deepEqual(checkListing(ok, today), {
    ok: { name: 'Kale', price: 120, stock_quantity: 5, harvest_date: '2026-11-18', best_before: '2026-11-25' },
  });
});

test('each bad field gives its message', () => {
  const err = (over: Partial<typeof ok>) => {
    const r = checkListing({ ...ok, ...over }, today);
    return 'error' in r ? r.error : null;
  };
  assert.match(err({ name: '  ' })!, /Name is required/);
  assert.match(err({ name: 'x'.repeat(LISTING_NAME_MAX + 1) })!, /at most 100/);
  for (const price of ['0', '1.5', '-3', 'abc', String(LISTING_PRICE_MAX + 1)]) assert.match(err({ price })!, /Price/, price);
  for (const stock of ['-1', '2.5', String(LISTING_STOCK_MAX + 1)]) assert.match(err({ stock })!, /Stock/, stock);
  assert.equal(err({ stock: '0' }), null);
  assert.match(err({ harvestDate: '2026-02-30' })!, /real date/);
  assert.match(err({ harvestDate: '' })!, /required/);
  assert.match(err({ harvestDate: '2026-11-20' })!, /future/);
  assert.match(err({ bestBefore: '2026-11-01' })!, /earlier than the harvest/);
});

test('bounds = backend schemas/produce.py', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const py = readFileSync(join(repo, 'backend/app/schemas/produce.py'), 'utf8');
  const num = (name: string) => Number(new RegExp(`^${name} = ([\\d_]+)`, 'm').exec(py)?.[1].replace(/_/g, ''));
  assert.equal(num('MAX_NAME'), LISTING_NAME_MAX);
  assert.equal(num('MAX_PRICE'), LISTING_PRICE_MAX);
  assert.equal(num('MAX_STOCK'), LISTING_STOCK_MAX);
});
