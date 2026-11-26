import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseMapProvider, mapAvailable } from './mapProvider.ts';

test('the switch picks google with a key, native without one, and obeys an explicit value', () => {
  assert.equal(chooseMapProvider(undefined, true), 'google');
  assert.equal(chooseMapProvider('', false), 'native');
  assert.equal(chooseMapProvider(' Native ', true), 'native');
  assert.equal(chooseMapProvider('google', false), 'google');
  assert.equal(chooseMapProvider('mapbox', true), 'google');
});

test('Google Maps needs the key on both platforms; Apple Maps does not', () => {
  assert.equal(mapAvailable('google', 'ios', false), false);
  assert.equal(mapAvailable('google', 'ios', true), true);
  assert.equal(mapAvailable('native', 'ios', false), true);
  assert.equal(mapAvailable('native', 'android', false), false);
});
