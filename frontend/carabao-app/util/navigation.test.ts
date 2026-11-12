// Run with `npm test` (Node's built-in runner; Node 22.18+ strips the types).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleMapsDirectionsUrl, isNavigable, wazeNavigationUrl } from './navigation.ts';

test('Google Maps link opens driving directions to the stop', () => {
  const url = new URL(googleMapsDirectionsUrl(14.5995, 120.9842));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('destination'), '14.5995,120.9842');
  assert.equal(url.searchParams.get('travelmode'), 'driving');
});

test('Waze link navigates to the stop', () => {
  const url = new URL(wazeNavigationUrl(14.5995, 120.9842));
  assert.equal(url.origin + url.pathname, 'https://waze.com/ul');
  assert.equal(url.searchParams.get('ll'), '14.5995,120.9842');
  assert.equal(url.searchParams.get('navigate'), 'yes');
});

test('non-finite or out-of-range coordinates are rejected', () => {
  for (const [lat, lng] of [
    [Number.NaN, 121],
    [14.6, Number.POSITIVE_INFINITY],
    [91, 121],
    [14.6, -181],
  ]) {
    assert.equal(isNavigable(lat, lng), false);
    assert.throws(() => googleMapsDirectionsUrl(lat, lng), RangeError);
    assert.throws(() => wazeNavigationUrl(lat, lng), RangeError);
  }
});

test('boundary coordinates are accepted', () => {
  assert.equal(isNavigable(-90, 180), true);
  assert.equal(isNavigable(0, 0), true);
});
