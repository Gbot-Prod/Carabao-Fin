// src/lib/routeMap.test.ts
// S12: the route map's pure rules - GeoJSON [lng, lat] to the map's coordinates, the region that
// frames every stop, the stop numbers and the shipmentId param. Run with `npm test`.
/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseShipmentId,
  regionForPoints,
  routePolyline,
  stopNumber,
  toLatLng,
  type RouteGeoJSON,
} from './routeMap.ts';

test('an API waypoint becomes a map coordinate', () => {
  assert.deepEqual(toLatLng({ lat: 14.5995, lng: 120.9842 }), {
    latitude: 14.5995,
    longitude: 120.9842,
  });
});

test('the road line keeps the GeoJSON order and swaps lng/lat', () => {
  const route: RouteGeoJSON = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[120.98, 14.59], [120.99, 14.6]] },
  };
  assert.deepEqual(routePolyline(route), [
    { latitude: 14.59, longitude: 120.98 },
    { latitude: 14.6, longitude: 120.99 },
  ]);
});

test('no road line, or no geometry, draws nothing', () => {
  assert.deepEqual(routePolyline(null), []);
  assert.deepEqual(routePolyline(undefined), []);
  assert.deepEqual(routePolyline({ type: 'Feature', geometry: null }), []);
  assert.deepEqual(routePolyline({ type: 'Feature', geometry: { type: 'LineString' } }), []);
});

test('an unusable coordinate is dropped, the rest of the line is kept', () => {
  const route: RouteGeoJSON = {
    geometry: {
      type: 'LineString',
      coordinates: [
        [120.98, 14.59],
        [Number.NaN, 14.6],
        [120.99],
        [121, 91],
        [181, 14.6],
        [121.01, 14.61],
      ],
    },
  };
  assert.deepEqual(routePolyline(route), [
    { latitude: 14.59, longitude: 120.98 },
    { latitude: 14.61, longitude: 121.01 },
  ]);
});

test('no points means no region', () => {
  assert.equal(regionForPoints([]), null);
  assert.equal(regionForPoints([{ latitude: Number.NaN, longitude: 121 }]), null);
});

test('a single stop gets a region of the minimum span, centred on it', () => {
  assert.deepEqual(regionForPoints([{ latitude: 14.6, longitude: 121 }]), {
    latitude: 14.6,
    longitude: 121,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
});

test('several stops are framed with room to spare', () => {
  const region = regionForPoints([
    { latitude: 14.5, longitude: 120.9 },
    { latitude: 14.7, longitude: 121.1 },
  ]);
  assert.ok(region);
  assert.equal(region.latitude, 14.6);
  assert.equal(region.longitude, 121);
  // 0.2 degrees of stops, times the 1.3 padding.
  assert.ok(Math.abs(region.latitudeDelta - 0.26) < 1e-9);
  assert.ok(Math.abs(region.longitudeDelta - 0.26) < 1e-9);
});

test('two stops on the same pin still get the minimum span', () => {
  const region = regionForPoints([
    { latitude: 14.6, longitude: 121 },
    { latitude: 14.6, longitude: 121 },
  ]);
  assert.deepEqual(region, {
    latitude: 14.6,
    longitude: 121,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
});

test('a stop is numbered by its route sequence, else by its place in the list', () => {
  assert.equal(stopNumber({ sequence: 3 }, 0), 3);
  assert.equal(stopNumber({ sequence: null }, 2), 3);
  assert.equal(stopNumber({}, 0), 1);
  assert.equal(stopNumber({ sequence: 0 }, 1), 2);
  assert.equal(stopNumber({ sequence: 2.5 }, 0), 1);
});

test('the shipmentId param is read from a link or a deep link', () => {
  assert.equal(parseShipmentId('12'), 12);
  assert.equal(parseShipmentId(['12', '13']), 12);
  assert.equal(parseShipmentId('0'), null);
  assert.equal(parseShipmentId('-3'), null);
  assert.equal(parseShipmentId('3.5'), null);
  assert.equal(parseShipmentId('route'), null);
  assert.equal(parseShipmentId(''), null);
  assert.equal(parseShipmentId(undefined), null);
});
