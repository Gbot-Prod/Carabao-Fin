// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressComplete, addressQuery, cityFits, cityQuery, findPlace, normalizePlace, pinAreaMismatch } from './pin-area.ts';

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

test('the pin opens only once the whole address is filled in', () => {
  const full = { province: 'Metro Manila', city: 'City of Taguig', barangay: 'Pinagsama', postalCode: '1630', street: 'Phase 2 Lawson' };
  assert.equal(addressComplete(full), true);
  assert.equal(addressComplete({ ...full, street: '  ' }), false);
  assert.equal(addressComplete({ ...full, postalCode: '' }), false);
  assert.equal(addressComplete({ ...full, barangay: undefined }), false);
});

test('the address query waits for a city and uses plain names', () => {
  assert.equal(addressQuery({ street: 'Ridgewood Towers', province: 'Metro Manila' }), null);
  assert.equal(
    addressQuery({ street: ' Ridgewood Towers ', barangay: 'Fort Bonifacio', city: 'City of Taguig', province: 'Metro Manila' }),
    'Ridgewood Towers, Fort Bonifacio, Taguig, Metro Manila',
  );
  assert.equal(
    addressQuery({ street: '12 Mabini St', barangay: 'Poblacion (Pob.)', city: 'City of Malolos ', province: 'Bulacan' }, false),
    'Poblacion, Malolos, Bulacan',
  );
});

test('the city query shows the area when the address is not found', () => {
  assert.equal(cityQuery({ street: 'x', city: 'City of Taguig', province: 'Metro Manila' }), 'Taguig, Metro Manila');
  assert.equal(cityQuery({ province: 'Bulacan' }), null);
});

test('a geocoding hit fits the picked city', () => {
  assert.equal(cityFits(['Taguig'], 'City of Taguig'), true);
  assert.equal(cityFits(['Makati'], 'City of Taguig'), false);
  assert.equal(cityFits([], 'City of Taguig'), true);
  // Manila's districts are the PSGC cities; Mapbox says "Manila".
  assert.equal(cityFits(['Manila'], 'Sampaloc'), true);
});

test('a pin in another city is flagged; the typed address is not changed', () => {
  const typed = { region: 'NCR', province: 'Metro Manila', city: 'City of Taguig', barangay: 'Fort Bonifacio' };
  assert.equal(pinAreaMismatch({ region: 'NCR', province: 'Metro Manila', city: 'City of Taguig' }, typed), null);
  assert.deepEqual(
    pinAreaMismatch({ region: 'NCR', province: 'Metro Manila', city: 'City of Makati' }, typed),
    { pin: 'City of Makati', typed: 'City of Taguig' },
  );
  // Barangays are not compared.
  assert.equal(pinAreaMismatch({ region: 'NCR', province: 'Metro Manila', city: 'City of Taguig', barangay: 'Pinagsama' }, typed), null);
  // Whole City of Manila vs a district: cannot tell.
  assert.equal(pinAreaMismatch({ region: 'NCR', province: 'Metro Manila', city: 'City of Manila' }, { ...typed, city: 'Sampaloc' }), null);
  // Only the province known.
  assert.deepEqual(
    pinAreaMismatch({ region: 'Region III (Central Luzon)', province: 'Pampanga' }, { region: 'Region III (Central Luzon)', province: 'Bulacan' }),
    { pin: 'Pampanga', typed: 'Bulacan' },
  );
  assert.equal(pinAreaMismatch(null, typed), null);
});
