/// <reference types="node" />
// Run with `npm test`. CF-0108.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mustWipe, updateFor, valueFor, type Owned } from './ownedState.ts';

const cartA: Owned<string[]> = { owner: 'A', value: ['kale'] };

test('only the owner sees the value', () => {
  assert.deepEqual(valueFor(cartA, 'A', []), ['kale']);
  assert.deepEqual(valueFor(cartA, 'B', []), []); // account switch
  assert.deepEqual(valueFor(cartA, null, []), []); // signed out
  assert.deepEqual(valueFor(null, 'A', []), []);
});

test('sign-out or another account wipes the state; the same account keeps it', () => {
  assert.equal(mustWipe(cartA, null), true);
  assert.equal(mustWipe(cartA, 'B'), true);
  assert.equal(mustWipe(cartA, 'A'), false);
  assert.equal(mustWipe(null, null), false);
});

test("a change starts from empty when the state was someone else's", () => {
  const add = (v: string[]) => [...v, 'rice'];
  assert.deepEqual(updateFor(cartA, 'A', [], add), { owner: 'A', value: ['kale', 'rice'] });
  assert.deepEqual(updateFor(cartA, 'B', [], add), { owner: 'B', value: ['rice'] });
  assert.equal(updateFor(cartA, null, [], add), null); // signed out keeps nothing
});

test('shared phone: A fills a cart, signs out, B signs in and sees nothing of it', () => {
  let state: Owned<string[]> = updateFor<string[]>(null, 'A', [], (v) => [...v, 'kale']);
  if (mustWipe(state, null)) state = null; // A signs out
  assert.equal(state, null);
  assert.deepEqual(valueFor(state, 'B', []), []); // B signs in
});
