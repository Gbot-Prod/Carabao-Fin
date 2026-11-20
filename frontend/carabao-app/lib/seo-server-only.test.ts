// Run with `npm test`. CF-0088 (B91): the shared server secret must never reach
// the browser bundle. No client component may read AUTH_SYNC_SHARED_SECRET or
// import lib/seo (which sends it on the listing fetch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'components', 'lib', 'util'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const isClient = (src: string) => /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(src);

test('no client file reads the shared secret or imports lib/seo', () => {
  const clientFiles = ROOTS.flatMap(sourceFiles).filter((f) => isClient(readFileSync(f, 'utf8')));
  assert.ok(clientFiles.length > 10, 'expected to find the client components');
  const offenders = clientFiles.filter((f) => {
    const src = readFileSync(f, 'utf8');
    return src.includes('AUTH_SYNC_SHARED_SECRET') || /from ['"]@\/lib\/seo['"]/.test(src);
  });
  assert.deepEqual(offenders, []);
});

test('the secret is not given a NEXT_PUBLIC_ name anywhere', () => {
  const offenders = ROOTS.flatMap(sourceFiles).filter((f) =>
    readFileSync(f, 'utf8').includes('NEXT_PUBLIC_AUTH_SYNC'),
  );
  assert.deepEqual(offenders, []);
});
