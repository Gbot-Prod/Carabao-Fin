// src/lib/navigation.test.ts
// S12: the stop links (Google Maps and Waze, the same two apps as the web) and the stop-status
// words. The first four cases are the web's util/navigation.test.ts; run with `npm test`.
/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  googleMapsDirectionsUrl,
  isClosedStatus,
  isNavigable,
  isRouteFinished,
  statusLabel,
  wazeNavigationUrl,
} from './navigation.ts';

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

test('a stop is closed once its order is delivered, cancelled or refunded', () => {
  assert.equal(isClosedStatus('delivered'), true);
  assert.equal(isClosedStatus('cancelled'), true);
  assert.equal(isClosedStatus('payment_mismatch'), true);
  assert.equal(isClosedStatus('shipped'), false);
  assert.equal(isClosedStatus('out_for_delivery'), false);
  assert.equal(isClosedStatus(null), false);
  assert.equal(isClosedStatus(undefined), false);
});

test('status labels use the web words and fall back to the raw status', () => {
  assert.equal(statusLabel('out_for_delivery'), 'Out for delivery');
  assert.equal(statusLabel('payment_mismatch'), 'Payment problem');
  assert.equal(statusLabel('something_new'), 'something new');
  assert.equal(statusLabel(null), 'Status unknown');
  assert.equal(statusLabel(undefined), 'Status unknown');
});

test('a route is finished only when it has stops and every stop is closed', () => {
  assert.equal(isRouteFinished({ stops: [] }), false);
  assert.equal(isRouteFinished({ stops: [{ status: 'delivered' }, { status: 'cancelled' }] }), true);
  assert.equal(isRouteFinished({ stops: [{ status: 'delivered' }, { status: 'shipped' }] }), false);
});
