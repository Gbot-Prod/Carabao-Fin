// src/lib/serviceArea.ts
// S13: copied from the web app (frontend/carabao-app/util/serviceArea.ts) so the address form and
// the pin autofill let a farm pick a Luzon region only, and so both clients name NCR's province
// the same way. Onboarding (S17) uses this same file; keep it in step with the web
// (inStep.test.ts checks NCR_PROVINCE against it).
// Carabao serves part of the Luzon island group only (B2): NCR, CAR, Regions I,
// II, III, IV-A (CALABARZON) and V (Bicol). MIMAROPA (IV-B) is not served.
// Mirrors backend/app/services/service_area.py, which is the check that counts.

const REGION_NAMES = [
  'ncr', 'national capital', 'metro manila', 'car', 'cordillera', 'ilocos',
  'cagayan valley', 'central luzon', 'calabarzon', 'bicol',
];
// MIMAROPA (Region IV-B), however it is written.
const EXCLUDED_REGION = /mimaropa|southwestern tagalog|\bregion\s*-?\s*(iv|4)\s*-?\s*b\b/;
const REGION_NUMBERS: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

// Needles are plain lowercase words (no regex characters), so no escaping is needed.
const hasWord = (haystack: string, needle: string) =>
  new RegExp(`(^|[^a-z0-9_])${needle}($|[^a-z0-9_])`).test(haystack);

// Site standard: NCR has no provinces, so its province is shown and saved as this.
export const NCR_PROVINCE = 'Metro Manila';

export const SERVICE_AREA_NOTE = 'Carabao currently delivers within Luzon only, except MIMAROPA.';

export function isLuzonRegion(region: string | null | undefined): boolean {
  if (!region || !region.trim()) return false;
  const name = region.toLowerCase().replace(/\s+/g, ' ').trim();
  if (EXCLUDED_REGION.test(name)) return false;
  if (REGION_NAMES.some((n) => hasWord(name, n))) return true;
  const match = name.match(/\bregion\s*-?\s*([ivx]+|\d+)\b/);
  if (!match) return false;
  const numeral = match[1];
  const number = /^\d+$/.test(numeral) ? Number(numeral) : REGION_NUMBERS[numeral];
  return number !== undefined && number >= 1 && number <= 5;
}
