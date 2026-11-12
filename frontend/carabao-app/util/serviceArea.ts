// Carabao serves the Luzon island group only (B2): NCR, CAR, Regions I, II, III,
// IV-A (CALABARZON), MIMAROPA (IV-B) and V (Bicol). Mirrors
// backend/app/services/service_area.py, which is the check that counts.

const REGION_NAMES = [
  'ncr', 'national capital', 'metro manila', 'car', 'cordillera', 'ilocos',
  'cagayan valley', 'central luzon', 'calabarzon', 'mimaropa', 'southwestern tagalog', 'bicol',
];
const REGION_NUMBERS: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

// Needles are plain lowercase words (no regex characters), so no escaping is needed.
const hasWord = (haystack: string, needle: string) =>
  new RegExp(`(^|[^a-z0-9_])${needle}($|[^a-z0-9_])`).test(haystack);

export const SERVICE_AREA_NOTE = 'Carabao currently delivers within Luzon only.';

export function isLuzonRegion(region: string | null | undefined): boolean {
  if (!region || !region.trim()) return false;
  const name = region.toLowerCase().replace(/\s+/g, ' ').trim();
  if (REGION_NAMES.some((n) => hasWord(name, n))) return true;
  const match = name.match(/\bregion\s*-?\s*([ivx]+|\d+)\b/);
  if (!match) return false;
  const numeral = match[1];
  const number = /^\d+$/.test(numeral) ? Number(numeral) : REGION_NUMBERS[numeral];
  return number !== undefined && number >= 1 && number <= 5;
}
