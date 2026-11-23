// src/lib/route.test.ts
// S12: the Route screen's words and formatters. Run with `npm test`.
/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HONESTY_NOTE,
  REPORT_NOTE_MAX,
  formatArrival,
  formatDuration,
  formatUpdatedAt,
  navigateToLabel,
  plannedArrivalLabel,
  plannedDurationLabel,
  reportPinToLabel,
  shipmentLabel,
  stopLabel,
  stopsDoneLabel,
  updatedLabel,
  wazeToLabel,
} from './route.ts';

test('the planned drive time reads as minutes, or hours and minutes', () => {
  assert.equal(formatDuration(0), '1 min');
  assert.equal(formatDuration(20), '1 min');
  assert.equal(formatDuration(600), '10 min');
  assert.equal(formatDuration(2700), '45 min');
  assert.equal(formatDuration(3600), '1 h 0 min');
  assert.equal(formatDuration(4800), '1 h 20 min');
  assert.equal(formatDuration(3660), '1 h 1 min');
});

test('an arrival time is null when there is none, or when it cannot be read', () => {
  assert.equal(formatArrival(null), null);
  assert.equal(formatArrival(undefined), null);
  assert.equal(formatArrival(''), null);
  assert.equal(formatArrival('not a date'), null);
  const shown = formatArrival('2026-11-24T15:05:00+08:00');
  assert.ok(shown && shown.length > 0, 'a valid arrival should be printed');
});

test('the updated time is null before the first refresh', () => {
  assert.equal(formatUpdatedAt(null), null);
  assert.ok(formatUpdatedAt(Date.UTC(2026, 10, 24, 15, 5)));
});

test('the screen labels carry the numbers the web shows', () => {
  assert.equal(shipmentLabel(12), 'Shipment #12');
  assert.equal(stopsDoneLabel(2, 5), '2 of 5 stops done');
  assert.equal(plannedDurationLabel('1 h 20 min'), 'Planned drive time 1 h 20 min');
  assert.equal(updatedLabel('3:05 PM'), 'Updated 3:05 PM');
  assert.equal(plannedArrivalLabel('Nov 24, 3:05 PM'), 'Planned arrival Nov 24, 3:05 PM');
  assert.equal(stopLabel(3), 'Stop 3');
});

test('the navigation and report labels name the stop and the app', () => {
  assert.equal(navigateToLabel(2), 'Navigate to stop 2 in Google Maps');
  assert.equal(wazeToLabel(2), 'Navigate to stop 2 in Waze');
  assert.equal(reportPinToLabel(2), 'Report that you cannot get to the pin of stop 2');
});

test('the honest note says there is no live GPS, and the note limit is the backend one', () => {
  assert.match(HONESTY_NOTE, /no live GPS/);
  assert.equal(REPORT_NOTE_MAX, 200);
});
