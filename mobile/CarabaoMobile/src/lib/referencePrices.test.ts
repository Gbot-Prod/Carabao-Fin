/// <reference types="node" />
// Run with `npm test`. CF-0106. Same rules as backend services/reference_prices.match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchReferencePrice, referenceLabel, type ApiReferencePrice } from './referencePrices.ts';

const price = (over: Partial<ApiReferencePrice>): ApiReferencePrice => ({
  id: 1, commodity: 'gourd', aliases: [], unit: 'kg', low: 10, high: 20, source: 'DA', as_of: '2026-11-01',
  is_sample: false, ...over,
});

test('whole words only, longest name wins', () => {
  const gourd = price({ id: 1, commodity: 'gourd' });
  const bitter = price({ id: 2, commodity: 'bitter gourd', aliases: ['ampalaya'] });
  assert.equal(matchReferencePrice([gourd, bitter], 'Fresh Bitter Gourd')?.id, 2);
  assert.equal(matchReferencePrice([gourd, bitter], 'Ampalaya (organic)')?.id, 2);
  assert.equal(matchReferencePrice([gourd], 'Gourds'), null); // not a whole word
});

test('the same unit is preferred when names tie', () => {
  const kg = price({ id: 1, commodity: 'rice', unit: 'kg' });
  const sack = price({ id: 2, commodity: 'rice', unit: 'sack' });
  assert.equal(matchReferencePrice([kg, sack], 'Rice', 'sack')?.id, 2);
  assert.equal(matchReferencePrice([kg, sack], 'Rice', 'kg')?.id, 1);
});

test('no name, no match', () => {
  assert.equal(matchReferencePrice([price({})], null), null);
  assert.equal(matchReferencePrice([price({})], ''), null);
  assert.equal(matchReferencePrice([], 'gourd'), null);
});

test('label: sample rows always say so, real rows name the source', () => {
  assert.match(referenceLabel(price({ is_sample: true })), /\(sample data\)$/);
  assert.match(referenceLabel(price({ source: 'DA Bantay Presyo' })), /· DA Bantay Presyo$/);
});
