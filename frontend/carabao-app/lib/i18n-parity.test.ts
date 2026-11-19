// Run with `npm test`.
// CF-0086: the `Strings` type makes tsc check that fil has every en key, but not that
// each text is non-empty or keeps the same "{name}" placeholders. A lost placeholder
// shows a raw value gap (or "{code}") to Filipino users only, so check it at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import en from './i18n/strings/en.ts';
import fil from './i18n/strings/fil.ts';

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [p, v] of leaves(value, path)) out.set(p, v);
  }
  return out;
}

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

const enLeaves = leaves(en as unknown as Tree);
const filLeaves = leaves(fil as unknown as Tree);

test('fil has exactly the en keys', () => {
  assert.deepEqual([...filLeaves.keys()].sort(), [...enLeaves.keys()].sort());
});

test('no text is empty in either language', () => {
  for (const [lang, map] of [['en', enLeaves], ['fil', filLeaves]] as const) {
    for (const [key, text] of map) assert.ok(text.trim().length > 0, `${lang} ${key} is empty`);
  }
});

test('fil keeps the same placeholders as en', () => {
  for (const [key, text] of enLeaves) {
    const other = filLeaves.get(key);
    if (other === undefined) continue;
    assert.deepEqual(placeholders(other), placeholders(text), `placeholders differ at ${key}`);
  }
});

test('merchant confirm texts are in both languages (CF-0086)', () => {
  for (const key of ['deleteProduce', 'deleteReply', 'discardDraft', 'unpublishShop', 'deleteVoucher']) {
    assert.ok(enLeaves.has(`merchantConfirm.${key}`), key);
    assert.ok(filLeaves.has(`merchantConfirm.${key}`), key);
  }
  assert.deepEqual(placeholders(fil.merchantConfirm.deleteVoucher), ['code']);
});
