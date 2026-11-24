// S14 (plan §5.9): the merchant app's copy of the web's lib/shop-slug.ts.
// CF-0053 (B58): the shop page slug the web builds from the title. The API
// accepts ^[a-z0-9]+(?:-[a-z0-9]+)*$ (schemas/shopPage.py, CF-0051).
// inStep.test.ts feeds the same titles to both copies, so they cannot drift.
// Pure (no React Native imports), for `npm test`.

/** "Dela Cruz Farm" -> "dela-cruz-farm". Accents are folded ("Niño" -> "nino");
 *  a title with no letters or digits left gets `shop-<suffix>`, and a title of
 *  only digits gets `farm-<digits>` (a bare number is a farm id). */
export function shopSlug(title: string, suffix: string): string {
  const base = title
    .normalize('NFKD')
    // The combining marks NFKD splits off: U+0300 to U+036F (the web's literal range).
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  // Only digits would read as a farm id in /farms/<slug> (the API refuses it).
  if (/^\d+$/.test(base)) return `farm-${base}`;
  if (base) return base;
  const tail = suffix.toLowerCase().replace(/[^a-z0-9]+/g, '') || '1';
  return `shop-${tail}`;
}
