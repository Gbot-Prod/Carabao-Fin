/// <reference types="node" />
// Run with `npm test`. CF-0130 (was M64): a release build prints nothing. Every console
// call in src/ and app/ must sit in a function that returns early when !__DEV__, or
// inside an `if (__DEV__)` block, within the 4 lines above it. Release logs on Android
// can be read by other tools (adb, crash reporters) and must not carry tokens, phone
// numbers, addresses or order IDs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

test('CF-0130 no console call outside __DEV__', () => {
  const files = [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'app'))];
  assert.ok(files.length > 20, 'source files found');
  const unguarded: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/\bconsole\.[a-z]+\s*\(/.test(line) || /^\s*\/\//.test(line)) return;
      const context = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
      if (!/__DEV__/.test(context)) unguarded.push(`${relative(root, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(unguarded, []);
});
