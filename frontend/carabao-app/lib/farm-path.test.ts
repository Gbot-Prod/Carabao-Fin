// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farmPath, isFarmSlug, parseFarmParam } from './farm-path.ts';

test('farmPath uses the slug when it is usable', () => {
  assert.equal(farmPath(1, 'la-trinidad-highland'), '/farms/la-trinidad-highland');
  assert.equal(farmPath(1, 'farm-12'), '/farms/farm-12');
});

test('farmPath falls back to the id', () => {
  assert.equal(farmPath(7), '/farms/7');
  assert.equal(farmPath(7, null), '/farms/7');
  assert.equal(farmPath(7, ''), '/farms/7');
  // Only digits would read as another farm's id.
  assert.equal(farmPath(7, '12345'), '/farms/7');
  // Anything the API would refuse.
  assert.equal(farmPath(7, 'Has Spaces'), '/farms/7');
  assert.equal(farmPath(7, '../admin'), '/farms/7');
  assert.equal(farmPath(7, 'a'.repeat(81)), '/farms/7');
});

test('isFarmSlug follows the API rule', () => {
  assert.ok(isFarmSlug('dela-cruz-farm'));
  assert.ok(!isFarmSlug('-dela'));
  assert.ok(!isFarmSlug('dela--cruz'));
  assert.ok(!isFarmSlug('DELA'));
  assert.ok(!isFarmSlug('42'));
});

test('parseFarmParam reads ids', () => {
  assert.deepEqual(parseFarmParam('12'), { kind: 'id', id: 12 });
  assert.equal(parseFarmParam('0'), null);
  assert.equal(parseFarmParam('99999999999999999999'), null);
});

test('parseFarmParam reads slugs, any case', () => {
  assert.deepEqual(parseFarmParam('la-trinidad'), { kind: 'slug', slug: 'la-trinidad' });
  assert.deepEqual(parseFarmParam('La-Trinidad'), { kind: 'slug', slug: 'la-trinidad' });
});

test('parseFarmParam refuses what names no farm', () => {
  for (const raw of ['', 'abc def', '%E0%A4%A', 'a_b', '1.5', '-1', '..', 'a'.repeat(81)]) {
    assert.equal(parseFarmParam(raw), null, raw);
  }
});
