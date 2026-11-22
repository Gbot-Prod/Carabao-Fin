// Shared with mobile/CarabaoMobile/src/lib/apiErrors.test.ts. Keep both copies the same (sharedCopies.test.ts).
/// <reference types="node" />
// Run with `npm test`. CF-0123.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseErrorBody } from './apiErrors.ts';

test('backend FieldErrors: message plus one message per field', () => {
  assert.deepEqual(
    parseErrorBody({ detail: 'Street is too long. City is required.', errors: { address: 'Street is too long.', city: 'City is required.' } }),
    { message: 'Street is too long. City is required.', fields: { address: 'Street is too long.', city: 'City is required.' } },
  );
});

test('FastAPI 422: field from loc (top level), "Value error, " removed, lines joined', () => {
  const r = parseErrorBody({
    detail: [
      { loc: ['body', 'name'], msg: 'String should have at most 100 characters', type: 'string_too_long' },
      { loc: ['body', 'price_tiers', 0, 'unit_price'], msg: 'Input should be greater than or equal to 1' },
      { loc: ['body'], msg: 'Value error, Each produce may appear only once in the cart' },
      { loc: ['body', 'name'], msg: 'second message for name' },
    ],
  });
  assert.deepEqual(r.fields, {
    name: 'String should have at most 100 characters',
    price_tiers: 'Input should be greater than or equal to 1',
  });
  assert.equal(
    r.message,
    'String should have at most 100 characters\nInput should be greater than or equal to 1\nEach produce may appear only once in the cart\nsecond message for name',
  );
});

test('plain detail, odd shapes and junk are safe', () => {
  assert.deepEqual(parseErrorBody({ detail: 'Order not found' }), { message: 'Order not found', fields: {} });
  assert.deepEqual(parseErrorBody(null), { message: null, fields: {} });
  assert.deepEqual(parseErrorBody('html'), { message: null, fields: {} });
  assert.deepEqual(parseErrorBody({ detail: [{ msg: 5 }, null, 'x'] }), { message: null, fields: {} });
  assert.deepEqual(parseErrorBody({ errors: { 'bad key!': 'x', ok: 7, fine: 'y' } }).fields, { fine: 'y' });
  assert.deepEqual(parseErrorBody({ detail: [{ loc: ['body', '__proto__x', 1], msg: 'm' }] }).fields, { __proto__x: 'm' });
  const p = parseErrorBody(JSON.parse('{"errors":{"__proto__":"x","constructor":"y"},"detail":[{"loc":["body","__proto__"],"msg":"z"}]}'));
  assert.deepEqual(Object.keys(p.fields), []);
  assert.equal(Object.getPrototypeOf(p.fields), Object.prototype);
});
