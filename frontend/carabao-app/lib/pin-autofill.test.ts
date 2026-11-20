// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillText, findPlace, mergeLocation, normalizePlace } from './pin-autofill.ts';

test('city names match across Mapbox and PSGC forms', () => {
  const cities = [{ name: 'City of Malolos ' }, { name: 'City of Las Piñas' }, { name: 'Quezon City' }, { name: 'Santa Maria' }];
  assert.equal(findPlace(cities, ['Malolos City'], 'city')?.name, 'City of Malolos ');
  assert.equal(findPlace(cities, ['Malolos'], 'city')?.name, 'City of Malolos ');
  assert.equal(findPlace(cities, ['Las Pinas'], 'city')?.name, 'City of Las Piñas');
  assert.equal(findPlace(cities, ['Quezon City'], 'city')?.name, 'Quezon City');
  assert.equal(findPlace(cities, ['Sta. Maria'], 'city')?.name, 'Santa Maria');
  assert.equal(findPlace(cities, ['Cebu City'], 'city'), null);
});

test('barangay names drop prefixes and PSGC notes', () => {
  const barangays = [{ name: 'Barangay 1 (Pob.)' }, { name: 'Santo Rosario (Pob.)' }, { name: 'Longos' }];
  assert.equal(findPlace(barangays, ['Brgy. Longos'], 'barangay')?.name, 'Longos');
  assert.equal(findPlace(barangays, ['Sto. Rosario'], 'barangay')?.name, 'Santo Rosario (Pob.)');
  assert.equal(normalizePlace('Barangay 1 (Pob.)', 'barangay'), '1');
});

test('PSGC names stored as Latin-1 mojibake still match', () => {
  const barangays = [{ name: 'Santo NiÃ±o ' }, { name: 'Santor' }];
  assert.equal(findPlace(barangays, ['Santo Niño'], 'barangay')?.name, 'Santo NiÃ±o ');
  assert.equal(findPlace(barangays, ['Santo Nino'], 'barangay')?.name, 'Santo NiÃ±o ');
});

test('the first candidate that matches wins', () => {
  const provinces = [{ name: 'Bulacan' }, { name: 'Pampanga' }];
  assert.equal(findPlace(provinces, ['Central Luzon', 'Bulacan'], 'province')?.name, 'Bulacan');
});

test('the pin replaces the selects, deeper levels only kept under the same parent', () => {
  const current = { region: 'Region III (Central Luzon)', province: 'Bulacan', city: 'Bocaue', barangay: 'Lolomboy' };
  // Pin in another city, barangay not resolved: the old barangay goes.
  assert.deepEqual(
    mergeLocation(current, { region: 'Region III (Central Luzon)', province: 'Bulacan', city: 'City of Malolos ' }),
    { region: 'Region III (Central Luzon)', province: 'Bulacan', city: 'City of Malolos ', barangay: '' },
  );
  // Same city, barangay not resolved: the selected barangay stays.
  assert.deepEqual(
    mergeLocation(current, { region: 'Region III (Central Luzon)', province: 'Bulacan', city: 'Bocaue' }),
    current,
  );
  // Nothing resolved: no change.
  assert.equal(mergeLocation(current, null), current);
});

test('free text is filled only when empty or still the last autofill', () => {
  assert.equal(fillText('', '12 Mabini St', null), '12 Mabini St');
  assert.equal(fillText('12 Mabini St', '3 Rizal Ave', '12 Mabini St'), '3 Rizal Ave');
  assert.equal(fillText('Blk 4 Lot 2', '3 Rizal Ave', '12 Mabini St'), 'Blk 4 Lot 2');
  assert.equal(fillText('Blk 4 Lot 2', null, null), 'Blk 4 Lot 2');
});
