// Run with `npm test`. CF-0090: the CSP report endpoint's pure parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_REPORTS_PER_BODY,
  createLogBudget,
  readCappedText,
  stripQueryAndFragment,
  summarizeReports,
} from './csp-report.ts';

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

test('stripQueryAndFragment removes query and fragment, keeps keywords', () => {
  assert.equal(stripQueryAndFragment('https://x.ph/a?token=1#b'), 'https://x.ph/a');
  assert.equal(stripQueryAndFragment('https://x.ph/cb#access_token=abc'), 'https://x.ph/cb');
  assert.equal(stripQueryAndFragment('inline'), 'inline');
  assert.equal(stripQueryAndFragment('https://x.ph/p'), 'https://x.ph/p');
});

test('summarizeReports strips query and fragment from the page and the blocked URL', () => {
  const [legacy] = summarizeReports({
    'csp-report': {
      'violated-directive': 'img-src',
      'blocked-uri': 'https://evil.example/pixel.gif?phone=09171234567',
      'document-uri': 'https://carabao.ph/orders?ref=CB-1#secret',
    },
  });
  assert.deepEqual(legacy, {
    directive: 'img-src',
    blocked: 'https://evil.example/pixel.gif',
    page: 'https://carabao.ph/orders',
  });
  const [modern] = summarizeReports([
    { body: { effectiveDirective: 'script-src', blockedURL: 'eval', documentURL: 'https://carabao.ph/a?x=1' } },
  ]);
  assert.deepEqual(modern, { directive: 'script-src', blocked: 'eval', page: 'https://carabao.ph/a' });
});

test('summarizeReports caps the count and ignores odd shapes', () => {
  const many = Array.from({ length: 50 }, () => ({ body: { effectiveDirective: 'img-src' } }));
  assert.equal(summarizeReports(many).length, MAX_REPORTS_PER_BODY);
  assert.deepEqual(summarizeReports([null, 5, 'x', { body: 'text' }]), [{}, {}, {}, {}].map(() => ({
    directive: undefined,
    blocked: undefined,
    page: undefined,
  })));
});

test('readCappedText reads a small body and refuses a large one without content-length', async () => {
  assert.equal(await readCappedText(streamOf('{"a":', '1}'), 100), '{"a":1}');
  assert.equal(await readCappedText(streamOf('x'.repeat(60), 'y'.repeat(60)), 100), null);
  assert.equal(await readCappedText(null, 100), '');
  // Multi-byte text split across chunks decodes as one string.
  const bytes = new TextEncoder().encode('ñ');
  const split = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.slice(0, 1));
      c.enqueue(bytes.slice(1));
      c.close();
    },
  });
  assert.equal(await readCappedText(split, 100), 'ñ');
});

test('createLogBudget allows the limit per window and reports what it dropped', () => {
  const budget = createLogBudget(5, 60_000);
  assert.deepEqual(budget.take(3, 0), { allowed: 3, droppedBefore: 0 });
  assert.deepEqual(budget.take(4, 1_000), { allowed: 2, droppedBefore: 0 });
  assert.deepEqual(budget.take(10, 2_000), { allowed: 0, droppedBefore: 0 });
  // New window: the 12 dropped reports are reported once, the count resets.
  assert.deepEqual(budget.take(1, 60_000), { allowed: 1, droppedBefore: 12 });
  assert.deepEqual(budget.take(1, 61_000), { allowed: 1, droppedBefore: 0 });
  assert.deepEqual(budget.take(1, 200_000), { allowed: 1, droppedBefore: 0 });
});
