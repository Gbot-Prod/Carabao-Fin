// Shared with mobile/CarabaoMobile/src/lib/inputLimits.test.ts. Keep both copies the same (sharedCopies.test.ts).
/// <reference types="node" />
// Run with `npm test`. CF-0126.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CHAT_BODY_MAX, DELIVERY_ADDRESS_MAX, ORDER_NOTES_MAX, routeText } from './inputLimits.ts';

test('route text: short, single line, no control or direction characters', () => {
  assert.equal(routeText(' Dela Cruz Farm '), 'Dela Cruz Farm');
  for (const bad of [undefined, '', '   ', 'x'.repeat(101), 'A\nB', 'A\u0000', 'evil\u202eexe.png', 'A\u2028B']) {
    assert.equal(routeText(bad), null, JSON.stringify(bad));
  }
  assert.equal(routeText(['a']), null);
  assert.equal(routeText('x'.repeat(30), 20), null);
});

test('limits = backend files', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const chat = readFileSync(join(repo, 'backend/app/services/chat.py'), 'utf8');
  assert.match(chat, new RegExp(`^MAX_BODY = ${CHAT_BODY_MAX}\\b`, 'm'));
  const order = readFileSync(join(repo, 'backend/app/schemas/order.py'), 'utf8');
  assert.match(order, new RegExp(`delivery_address: str \\| None = Field\\(default=None, max_length=${DELIVERY_ADDRESS_MAX}\\)`));
  assert.match(order, new RegExp(`notes: str \\| None = Field\\(default=None, max_length=${ORDER_NOTES_MAX}\\)`));
});
