/// <reference types="node" />
// Run with `npm test`. Section S2: the upload checks the merchant screens use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_LIMIT_BYTES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  ONBOARDING_BODY_LIMIT_BYTES,
  checkDocument,
  checkImage,
  contentTypeFor,
  filePart,
  imageMimeType,
} from './uploads.ts';

test('S2 limits: images 5 MB, documents 10 MB, bodies 12 MB and 52 MB', () => {
  assert.deepEqual([...IMAGE_TYPES], ['image/png', 'image/jpeg', 'image/webp']);
  assert.deepEqual([...DOCUMENT_TYPES], ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
  assert.equal(IMAGE_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(DOCUMENT_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(BODY_LIMIT_BYTES, 12 * 1024 * 1024);
  assert.equal(ONBOARDING_BODY_LIMIT_BYTES, 52 * 1024 * 1024);
});

test('S2 checkImage: PNG/JPEG/WebP up to 5 MB', () => {
  for (const mimeType of IMAGE_TYPES) {
    assert.equal(checkImage({ size: 1, mimeType }), null);
    assert.equal(checkImage({ size: IMAGE_MAX_BYTES, mimeType }), null);
    assert.equal(checkImage({ size: IMAGE_MAX_BYTES + 1, mimeType }), 'The image must be 5MB or smaller.');
  }
  assert.equal(checkImage({ size: 1, mimeType: 'image/gif' }), 'The image must be a PNG, JPG or WebP.');
  assert.equal(checkImage({ size: 1, mimeType: null }), 'The image must be a PNG, JPG or WebP.');
  // A picker that leaves the size out cannot be checked here; the server still caps it.
  assert.equal(checkImage({ size: null, mimeType: 'image/png' }), null);
});

test('S2 checkDocument: the web DocumentDropzone messages, 10 MB', () => {
  for (const mimeType of DOCUMENT_TYPES) {
    assert.equal(checkDocument('government ID', { size: 1, mimeType }), null);
    assert.equal(checkDocument('government ID', { size: DOCUMENT_MAX_BYTES, mimeType }), null);
  }
  assert.equal(
    checkDocument('government ID', { size: DOCUMENT_MAX_BYTES + 1, mimeType: 'application/pdf' }),
    'government ID must be 10MB or smaller.',
  );
  assert.equal(
    checkDocument('RSBSA document', { size: 1, mimeType: 'image/gif' }),
    'RSBSA document must be a PDF or an image (PNG/JPG/WEBP).',
  );
  assert.equal(
    checkDocument('BIR Certificate of Registration', { size: 1, mimeType: undefined }),
    'BIR Certificate of Registration must be a PDF or an image (PNG/JPG/WEBP).',
  );
});

test('S6 imageMimeType: the picker type, else one from the file name', () => {
  assert.equal(imageMimeType('file:///cache/IMG_1.png', 'image/png'), 'image/png');
  assert.equal(imageMimeType('file:///cache/a.JPG', ' IMAGE/JPEG '), 'image/jpeg');
  // The camera can leave the type out.
  assert.equal(imageMimeType('file:///cache/IMG_0001.jpg', null), 'image/jpeg');
  assert.equal(imageMimeType('content://media/external/images/media/42.webp'), 'image/webp');
  assert.equal(imageMimeType('file:///cache/a.jpeg?x=1', undefined), 'image/jpeg');
  // A generic type does not hide a real extension; an unknown file is left for checkImage.
  assert.equal(imageMimeType('file:///cache/a.png', 'application/octet-stream'), 'image/png');
  assert.equal(imageMimeType('file:///cache/a.gif', null), null);
  assert.equal(imageMimeType('file:///cache/a.gif', 'image/gif'), 'image/gif');
  // So a GIF still fails the S2 check, whatever the picker called it.
  assert.match(checkImage({ size: 1, mimeType: imageMimeType('file:///cache/a.gif') })!, /PNG, JPG or WebP/);
});

test('S2 filePart: the React Native FormData file shape, with fallbacks', () => {
  assert.deepEqual(filePart('file:///cache/rsbsa.pdf', 'rsbsa.pdf', 'application/pdf'), {
    uri: 'file:///cache/rsbsa.pdf',
    name: 'rsbsa.pdf',
    type: 'application/pdf',
  });
  // expo-document-picker on Android can return neither a name nor a type.
  assert.deepEqual(filePart('file:///cache/scan-1.pdf', null, null), {
    uri: 'file:///cache/scan-1.pdf',
    name: 'scan-1.pdf',
    type: 'application/octet-stream',
  });
  assert.deepEqual(filePart('content://media/external/1234', '  ', '  '), {
    uri: 'content://media/external/1234',
    name: '1234',
    type: 'application/octet-stream',
  });
  assert.deepEqual(filePart('content://media/', undefined, undefined), {
    uri: 'content://media/',
    name: 'upload',
    type: 'application/octet-stream',
  });
});

test('S2 contentTypeFor: JSON only for a string body', () => {
  assert.equal(contentTypeFor(JSON.stringify({ payload: {} })), 'application/json');
  assert.equal(contentTypeFor(''), 'application/json');
  assert.equal(contentTypeFor(new FormData()), null);
  assert.equal(contentTypeFor(new Blob(['x'])), null);
  assert.equal(contentTypeFor(new URLSearchParams({ a: '1' })), null);
  assert.equal(contentTypeFor(null), null);
  assert.equal(contentTypeFor(undefined), null);
});
