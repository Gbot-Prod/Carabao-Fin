import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECENT_FARMS_KEY,
  RECENT_FARMS_MAX,
  addRecentFarm,
  parseRecentFarms,
  readRecentFarms,
  rememberFarm,
  type RecentFarm,
} from './recently-viewed.ts';

// CF-0052
const farm = (id: number, viewedAt = id): RecentFarm => ({ id, name: `Farm ${id}`, town: null, logo: null, viewedAt });

test('a visit moves the farm to the front, once, and the list is capped', () => {
  let list: RecentFarm[] = [];
  for (let i = 1; i <= RECENT_FARMS_MAX + 2; i++) list = addRecentFarm(list, farm(i));
  assert.equal(list.length, RECENT_FARMS_MAX);
  assert.equal(list[0].id, RECENT_FARMS_MAX + 2);
  list = addRecentFarm(list, farm(5, 999));
  assert.equal(list[0].id, 5);
  assert.equal(list.filter((f) => f.id === 5).length, 1);
});

test('stored data is validated, bad entries dropped', () => {
  const raw = JSON.stringify([
    { id: 1, name: 'Ana Farm', town: 'Malolos, Bulacan', logo: 'https://r2.example/logo.png', viewedAt: 5 },
    { id: 1, name: 'Duplicate', viewedAt: 6 },
    { id: -2, name: 'Bad id' },
    { id: 3, name: '' },
    { id: 4, name: 'Script logo', logo: 'javascript:alert(1)' },
    'junk',
  ]);
  const list = parseRecentFarms(raw);
  assert.deepEqual(list.map((f) => f.id), [1, 4]);
  assert.equal(list[1].logo, null);
  assert.deepEqual(parseRecentFarms('{not json'), []);
  assert.deepEqual(parseRecentFarms(JSON.stringify({ id: 1 })), []);
  assert.deepEqual(parseRecentFarms(null), []);
});

test('blocked or full storage never throws', () => {
  const blocked = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
  assert.deepEqual(readRecentFarms(blocked), []);
  assert.equal(rememberFarm(blocked, farm(1)), false);
  assert.equal(rememberFarm(null, farm(1)), false);
});

test('remember round-trips through storage', () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  assert.equal(rememberFarm(store, farm(2)), true);
  assert.equal(rememberFarm(store, farm(3)), true);
  assert.deepEqual(readRecentFarms(store).map((f) => f.id), [3, 2]);
  assert.ok(data.has(RECENT_FARMS_KEY));
});

