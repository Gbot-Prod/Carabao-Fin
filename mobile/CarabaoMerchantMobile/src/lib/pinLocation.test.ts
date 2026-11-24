// src/lib/pinLocation.test.ts
// S13: the address form's pure rules - PSGC/Mapbox name matching, the pin placed from the typed
// address, the pin's area check, and the form's own field checks and save shape. The PSGC and
// geocoding requests themselves are not here (they need the network); inStep.test.ts checks the
// words against the web. Run with `npm test`.
/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDRESS_LABELS,
  ADDRESS_MAX,
  ADDRESS_MESSAGES,
  addressComplete,
  addressHit,
  addressPayload,
  addressQuery,
  checkAddress,
  cityFits,
  cityQuery,
  EMPTY_ADDRESS,
  findPlace,
  LOCATION_WORDS,
  normalizePlace,
  PIN_WORDS,
  pinAreaMismatch,
  pinMismatchText,
  placeHints,
  repairMojibake,
  roadNoteText,
  ROAD_MARKER_MIN_M,
  samePin,
  zoomFor,
  type AddressValue,
} from './pinLocation.ts';

const filled: AddressValue = {
  region: 'National Capital Region (NCR)',
  province: 'Metro Manila',
  city: 'Makati',
  barangay: 'Poblacion',
  postal_code: '1210',
  street: '123 Rizal St.',
  latitude: 14.5547,
  longitude: 121.0244,
  pin_confirmed: true,
};

test('PSGC names are compared in a normal form, and PSGC spellings win', () => {
  assert.equal(normalizePlace('City of Malolos ', 'city'), 'malolos');
  assert.equal(normalizePlace('Malolos City', 'city'), 'malolos');
  assert.equal(normalizePlace('City of Las Piñas', 'city'), 'las pinas');
  assert.equal(normalizePlace('Las Pinas', 'city'), 'las pinas');
  assert.equal(normalizePlace('Sta. Cruz', 'barangay'), 'santa cruz');
  assert.equal(normalizePlace('Brgy. Santo Niño', 'barangay'), 'santo nino');
  assert.equal(normalizePlace('Province of Bulacan', 'province'), 'bulacan');
  // The parentheses are a note, not part of the name.
  assert.equal(normalizePlace('Poblacion (District 1)', 'barangay'), 'poblacion');
});

test('a PSGC name read as Latin-1 is repaired before it is compared', () => {
  // The PSGC API answers "Santo NiÃ±o" for "Santo Niño": the bytes are UTF-8, read as Latin-1.
  assert.equal(repairMojibake('Santo NiÃ±o'), 'Santo Niño');
  assert.equal(repairMojibake('Santo Niño'), 'Santo Niño');
  assert.equal(normalizePlace('Santo NiÃ±o', 'barangay'), 'santo nino');
  // A name with no mojibake marker is left exactly as it is.
  assert.equal(repairMojibake('Manila'), 'Manila');
});

test('the option is matched on any candidate, in candidate order', () => {
  const cities = [
    { code: '1', name: 'Malolos' },
    { code: '2', name: 'City of Malolos' },
  ];
  assert.equal(findPlace(cities, ['Malolos City'], 'city')?.code, '1');
  assert.equal(findPlace(cities, [], 'city'), null);
  assert.equal(findPlace([], ['Malolos'], 'city'), null);
  // An unnamed option is never matched, so a blank candidate does not name the first row.
  assert.equal(findPlace([{ code: 'x', name: ' (old)' }], [''], 'city'), null);
});

test('the pin waits for the whole address, and is placed from it', () => {
  assert.equal(addressComplete({}), false);
  assert.equal(
    addressComplete({ province: 'Metro Manila', city: 'Makati', barangay: 'Poblacion', postalCode: '1210' }),
    false,
  );
  assert.equal(
    addressComplete({
      province: 'Metro Manila', city: 'Makati', barangay: 'Poblacion', postalCode: '1210', street: '   ',
    }),
    false,
  );
  const typed = { ...filled, postalCode: filled.postal_code, street: filled.street };
  assert.equal(addressComplete(typed), true);

  assert.equal(addressQuery(typed), '123 Rizal St., Poblacion, Makati, Metro Manila');
  // The street is dropped for the second try, when the street search lands elsewhere.
  assert.equal(addressQuery(typed, false), 'Poblacion, Makati, Metro Manila');
  assert.equal(addressQuery({ street: '123 Rizal St.' }), null);
  // "City of ..." is dropped and a barangay note is left out: Mapbox reads the plain names.
  assert.equal(
    addressQuery({ street: '1 Mabini St.', barangay: 'Poblacion (Dist. 1)', city: 'City of Makati', province: 'Metro Manila' }),
    '1 Mabini St., Poblacion, Makati, Metro Manila',
  );
  assert.equal(cityQuery(typed), 'Makati, Metro Manila');
  assert.equal(cityQuery({}), null);
});

test('a hit is kept only when its city fits the picked one', () => {
  assert.equal(cityFits(['Makati'], 'Makati'), true);
  assert.equal(cityFits(['Makati City'], 'Makati'), true);
  // No city in the hit, or nothing picked yet: nothing to disagree with.
  assert.equal(cityFits([], 'Makati'), true);
  assert.equal(cityFits(['Makati'], undefined), true);
  assert.equal(cityFits(['Makati'], '  '), true);
  // Manila's districts are the PSGC cities, but Mapbox names the whole city.
  assert.equal(cityFits(['Manila'], 'Sampaloc'), true);
  assert.equal(cityFits(['Quezon City'], 'Makati'), false);
});

test('a pin in another city (or province) is flagged; a close one is not', () => {
  const typed = { region: 'CALABARZON', province: 'Bulacan', city: 'Makati' };
  assert.equal(pinAreaMismatch(null, typed), null);
  assert.equal(pinAreaMismatch({ province: 'Metro Manila' }, typed), null);
  assert.equal(pinAreaMismatch({ region: 'NCR', city: 'Makati City' }, typed), null);
  // The pin resolved to the whole City of Manila: its barangay is a district, not a city.
  assert.equal(pinAreaMismatch({ region: 'NCR', city: 'Manila' }, typed), null);
  assert.deepEqual(pinAreaMismatch({ region: 'NCR', city: 'Quezon City' }, typed), {
    pin: 'Quezon City',
    typed: 'Makati',
  });
  // No city at the pin: the province decides.
  assert.deepEqual(
    pinAreaMismatch({ region: 'Region III', province: 'Bulacan' }, { region: 'Region III', province: 'Pampanga' }),
    { pin: 'Bulacan', typed: 'Pampanga' },
  );
  assert.equal(
    pinAreaMismatch({ region: 'Region III', province: 'Bulacan' }, { region: 'Region III', province: 'Bulacan' }),
    null,
  );
  assert.equal(pinAreaMismatch({ region: 'NCR' }, { region: 'NCR' }), null);
});

test('Mapbox context becomes province, city and barangay names', () => {
  const hints = placeHints({
    id: 'address.123',
    text: '123 Rizal St.',
    place_type: ['address'],
    context: [
      { id: 'locality.1', text: 'Poblacion' },
      { id: 'place.2', text: 'Makati' },
      { id: 'region.3', text: 'Metro Manila' },
      { id: 'country.4', text: 'Philippines' },
    ],
  });
  assert.deepEqual(hints, { province: ['Metro Manila'], city: ['Makati'], barangay: ['Poblacion'] });
  // The feature itself counts: a city hit has no "place" in its context.
  assert.deepEqual(placeHints({ id: 'place.9', text: 'Makati', place_type: ['place'] }).city, ['Makati']);
  // A neighborhood feature counts as a barangay; a district as a province.
  assert.deepEqual(
    placeHints({ id: 'neighborhood.9', text: 'Poblacion', context: [{ id: 'district.1', text: 'Metro Manila' }] }),
    { province: ['Metro Manila'], city: [], barangay: ['Poblacion'] },
  );
  assert.deepEqual(placeHints(null), { province: [], city: [], barangay: [] });
  assert.deepEqual(placeHints(undefined), { province: [], city: [], barangay: [] });
});

test('the first pin is shown as close as the hit is precise', () => {
  assert.equal(zoomFor({ place_type: ['address'] }), 17);
  assert.equal(zoomFor({ place_type: ['poi'] }), 17);
  assert.equal(zoomFor({ place_type: ['locality'] }), 15);
  assert.equal(zoomFor({ place_type: ['neighborhood'] }), 15);
  assert.equal(zoomFor({ place_type: ['place'] }), 13);
  assert.equal(zoomFor({}), 13);
});

test('a geocoding feature becomes a pin, its zoom and its hints', () => {
  const hit = addressHit({
    place_type: ['address'],
    place_name: '123 Rizal St., Makati, Metro Manila, Philippines',
    center: [121.0244, 14.5547],
    context: [{ id: 'place.2', text: 'Makati' }],
  });
  assert.deepEqual(hit, {
    pin: { lng: 121.0244, lat: 14.5547 },
    zoom: 17,
    hints: { province: [], city: ['Makati'], barangay: [] },
  });
  // A feature with no center cannot place a pin.
  assert.equal(addressHit({ place_type: ['address'] }), null);
  assert.equal(addressHit(null), null);
});

test('a pin is the same one when it moved less than a tenth of a metre', () => {
  const pin = { lat: 14.5547, lng: 121.0244 };
  assert.equal(samePin(pin, { lat: 14.5547, lng: 121.0244 }), true);
  assert.equal(samePin(pin, { lat: 14.5548, lng: 121.0244 }), false);
  assert.equal(samePin(null, pin), false);
  assert.equal(samePin(pin, null), false);
  assert.equal(samePin(null, null), false);
});

test('the road marker shows only when the rider stops away from the pin', () => {
  // The web MapPinPicker shows the second marker from 5 m out (PIN_WORDS.roadNote).
  assert.equal(ROAD_MARKER_MIN_M, 5);
  assert.equal(roadNoteText(42.4), 'The rider stops at the dark marker, on the nearest road (42 m from your pin).');
  assert.equal(roadNoteText(0), 'The rider stops at the dark marker, on the nearest road (0 m from your pin).');
});

test('the mismatch words name both places', () => {
  assert.equal(
    pinMismatchText({ pin: 'Quezon City', typed: 'Makati' }),
    'Your pin looks like it is in Quezon City, but your address says Makati. Check the pin or the address.',
  );
});

test('an empty address names every field the person still has to fill in', () => {
  assert.deepEqual(checkAddress(EMPTY_ADDRESS), {
    address: ADDRESS_MESSAGES.address,
    region: ADDRESS_MESSAGES.region,
    // No region means no city question yet; no city means no barangay question yet.
    postal_code: ADDRESS_MESSAGES.postal_code,
    pin: ADDRESS_MESSAGES.pin,
  });
});

test('a complete address with a confirmed pin has nothing to report', () => {
  assert.deepEqual(checkAddress(filled), {});
  // A pin suggested from the address counts only once the person confirms it.
  assert.deepEqual(checkAddress({ ...filled, pin_confirmed: false }), {
    pin: ADDRESS_MESSAGES.pinUnconfirmed,
  });
  // S16/S18 may ask for the address before the pin (e.g. a read-only screen).
  assert.deepEqual(checkAddress({ ...filled, pin_confirmed: false }, { requirePin: false }), {});
});

test('Metro Manila has no province to pick, so none is asked for', () => {
  assert.deepEqual(checkAddress({ ...filled, province: '' }), {});
  // A region with provinces does ask; the NCR check is on the region, not the province alone.
  assert.deepEqual(checkAddress({ ...filled, region: 'CALABARZON', province: '' }), {
    province: ADDRESS_MESSAGES.province,
  });
  assert.equal(checkAddress({ ...filled, region: 'National Capital Region (NCR)', province: '' }).province, undefined);
});

test('a half-picked address asks for the next select only', () => {
  assert.deepEqual(checkAddress({ ...filled, city: '' }), { city: ADDRESS_MESSAGES.city });
  // A barangay is asked for only after a city: clearing both asks for the city alone.
  assert.deepEqual(checkAddress({ ...filled, city: '', barangay: '' }), { city: ADDRESS_MESSAGES.city });
  assert.deepEqual(checkAddress({ ...filled, region: '' }), { region: ADDRESS_MESSAGES.region });
  // Whitespace is not an answer.
  assert.deepEqual(checkAddress({ ...filled, street: '   ', postal_code: '  ' }), {
    address: ADDRESS_MESSAGES.address,
    postal_code: ADDRESS_MESSAGES.postal_code,
  });
});

test('a save trims the fields, fills NCR province and drops an unconfirmed pin', () => {
  assert.deepEqual(addressPayload({ ...filled, street: '  123 Rizal St.  ', postal_code: ' 1210 ' }), {
    region: 'National Capital Region (NCR)',
    province: 'Metro Manila',
    city: 'Makati',
    barangay: 'Poblacion',
    address: '123 Rizal St.',
    postal_code: '1210',
    latitude: 14.5547,
    longitude: 121.0244,
    pin_confirmed: true,
  });
  // The pin is saved only once confirmed: a suggestion is not a checked pin.
  assert.deepEqual(addressPayload({ ...filled, pin_confirmed: false }), {
    ...addressPayload(filled),
    latitude: null,
    longitude: null,
    pin_confirmed: false,
  });
  // A saved NCR address with no province gets the site's name for it.
  assert.equal(addressPayload({ ...filled, province: '' }).province, 'Metro Manila');
  // Any other region keeps an empty province empty (it was never filled in).
  assert.equal(addressPayload({ ...filled, region: 'CALABARZON', province: '' }).province, '');
});

test('the field names and limits match the backend and the web inputs', () => {
  // backend/app/schemas/merchant.py MerchantUpdate (inStep.test.ts reads the backend).
  assert.deepEqual(ADDRESS_MAX, {
    region: 100,
    province: 100,
    city: 100,
    barangay: 100,
    street: 500,
    postal_code: 10,
  });
  assert.deepEqual(ADDRESS_LABELS, {
    postalCode: 'Postal Code',
    postalPlaceholder: 'e.g. 2600',
    street: 'Street / House No.',
    streetPlaceholder: 'e.g. 123 Rizal St., Unit 4B',
  });
  // A save names the street `address`, like the backend and the web StoreDetails.
  assert.equal(addressPayload(filled).address, filled.street);
  assert.equal('street' in addressPayload(filled), false);
});

test('the words are the web onboarding words', () => {
  assert.equal(LOCATION_WORDS.region, 'Region');
  assert.equal(LOCATION_WORDS.selectBarangay, 'Select barangay');
  assert.equal(PIN_WORDS.confirmPin, 'This pin is correct');
  assert.equal(PIN_WORDS.locked, 'Fill in the full address above (region to street) to place your pin on the map.');
  // Metro Manila is the site's name for NCR's province (plan §2.2).
  assert.equal(LOCATION_WORDS.province, 'Province');
});
