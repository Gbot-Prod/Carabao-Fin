import { test } from 'node:test';
import assert from 'node:assert/strict';
import getApiErrorMessage, { getApiErrorDetail, getApiErrorStatus, getApiFieldErrors } from './errorHelper.ts';

// CF-0053 (B20/B58): the shared API error helpers.
const axiosLike = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

test('string detail wins over the generic axios message', () => {
  const err = axiosLike(409, { detail: 'Slug already taken' });
  assert.equal(getApiErrorMessage(err), 'Slug already taken');
  assert.equal(getApiErrorStatus(err), 409);
});

test('FastAPI 422 lists show the first field message', () => {
  const err = axiosLike(422, {
    detail: [
      { loc: ['body', 'unit_quantity'], msg: 'Input should be greater than 0', type: 'greater_than' },
      { loc: ['body', 'name'], msg: 'String should have at most 100 characters' },
    ],
  });
  assert.equal(getApiErrorMessage(err), 'unit quantity: Input should be greater than 0');
  assert.equal(getApiErrorDetail(axiosLike(422, { detail: [{ loc: ['body'], msg: 'Extra inputs are not permitted' }] })), 'Extra inputs are not permitted');
  assert.equal(getApiErrorDetail(axiosLike(422, { detail: [{ bad: true }, 'x'] })), undefined);
});

test('fallbacks: plain errors, plain text bodies, nothing usable', () => {
  assert.equal(getApiErrorMessage(axiosLike(502, 'Bad gateway')), 'Bad gateway');
  assert.equal(getApiErrorMessage(new Error('offline')), 'offline');
  assert.equal(getApiErrorMessage(null, 'Could not save.'), 'Could not save.');
  assert.equal(getApiErrorMessage({}, 'Could not save.'), 'Could not save.');
});

test('field errors are read from the CF FieldErrors shape only', () => {
  const err = axiosLike(400, { detail: 'Fix the fields', errors: { image_url: 'Upload the image instead', bad: 3 } });
  assert.deepEqual(getApiFieldErrors(err), { image_url: 'Upload the image instead' });
  assert.deepEqual(getApiFieldErrors(axiosLike(400, { detail: 'x' })), {});
});
