// CF-0053 (B58): the shop page slug the web builds from the title. The API
// accepts ^[a-z0-9]+(?:-[a-z0-9]+)*$ (schemas/shopPage.py, CF-0051).

/** "Dela Cruz Farm" -> "dela-cruz-farm". Accents are folded ("Niño" -> "nino");
 *  a title with no letters or digits left gets `shop-<suffix>`, and a title of
 *  only digits gets `farm-<digits>` (a bare number is a farm id). */
export function shopSlug(title: string, suffix: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  // Only digits would read as a farm id in /farms/<slug> (the API refuses it).
  if (/^\d+$/.test(base)) return `farm-${base}`;
  if (base) return base;
  const tail = suffix.toLowerCase().replace(/[^a-z0-9]+/g, "") || "1";
  return `shop-${tail}`;
}
