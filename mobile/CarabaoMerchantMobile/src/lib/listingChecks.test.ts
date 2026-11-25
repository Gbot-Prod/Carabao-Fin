/// <reference types="node" />
// Run with `npm test`. Guardrails Phase 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNotes, checkPayload, hasBlocks, marketPriceNote, reviewNote, type ProduceCheckResult } from './listingChecks.ts';

const result: ProduceCheckResult = {
  valid: false,
  has_hard_blocks: true,
  has_soft_flags: true,
  recommended_status: 'under_review',
  hard_blocks: [
    { field: 'name', code: 'CONTACT_INFO_DETECTED', message: 'Remove a phone number.' },
    { field: 'description', code: 'BAD_LANGUAGE', message: 'Remove the offensive language.' },
  ],
  soft_flags: [
    { field: 'category', code: 'CATEGORY_MISMATCH', message: 'Put it under Fruits.', suggestion: 'Fruits' },
    { field: 'best_before', code: 'EXCESSIVE_SHELF_LIFE', message: 'Too long.' },
  ],
};

test('checker results go under the form fields, the rest on top', () => {
  const notes = checkNotes(result);
  assert.equal(notes.blocks.name, 'Remove a phone number.');
  assert.deepEqual(notes.topBlocks, ['Remove the offensive language.']);
  assert.equal(notes.flags.bestBefore, 'Too long.');
  assert.deepEqual(notes.topFlags, ['Put it under Fruits.']);
  assert.equal(notes.categorySuggestion, 'Fruits');
  assert.equal(hasBlocks(notes), true);
  assert.equal(hasBlocks(checkNotes(null)), false);
});

test('the check payload leaves out half-typed values', () => {
  const p = checkPayload(
    {
      name: ' Talong ', price: '12a', stock: '5', harvestDate: '2026-11-2', bestBefore: '2026-11-30',
      minOrderQty: '', tiers: [{ minQty: '10', unitPrice: '50' }, { minQty: '', unitPrice: '40' }],
      unit: 'kg', category: null,
    },
    7,
  );
  assert.equal(p.name, 'Talong');
  assert.equal(p.price, null);
  assert.equal(p.harvest_date, null);
  assert.equal(p.best_before, '2026-11-30');
  assert.equal(p.min_order_qty, null);
  assert.deepEqual(p.price_tiers, [{ min_qty: 10, unit_price: 50 }]);
  assert.equal(p.produce_id, 7);
});

test('review state of a listing', () => {
  assert.equal(reviewNote({ status: 'live' }), null);
  assert.match(reviewNote({ status: 'under_review' }) ?? '', /24 hours/);
  assert.match(reviewNote({ status: 'rejected', rejection_reason: 'Wrong category.' }) ?? '', /Wrong category\./);
});

test('marketPriceNote recommends the NCR low end or less', () => {
  const market = {
    commodity: 'Tomato', low: 110, high: 120, unit: 'kg', source: 'DA Daily Price Index NCR',
    as_of: '2026-11-24', recommended_max: 110, price_per_kg: null as number | null,
  };
  assert.equal(marketPriceNote(null), null);
  const none = marketPriceNote(market)!;
  assert.match(none.range, /NCR market price for Tomato: ₱110–₱120 \/ kg/);
  assert.match(none.advice, /^Recommended: ₱110 \/ kg or less\./);
  assert.match(marketPriceNote({ ...market, price_per_kg: 60 })!.advice, /below the NCR market price/);
  assert.match(marketPriceNote({ ...market, price_per_kg: 115 })!.advice, /in the NCR market range/);
  assert.match(marketPriceNote({ ...market, price_per_kg: 150 })!.advice, /above the NCR market price/);
});
