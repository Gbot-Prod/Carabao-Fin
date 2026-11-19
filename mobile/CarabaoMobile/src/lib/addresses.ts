// CF-0110: saved delivery addresses (address book) and what checkout sends.
// Bounds = backend schemas/user_address.py; the delivery line = web checkout
// (app/(site)/(app)/checkout/page.tsx). Pure, for `npm test`.

export type SavedAddress = {
  id: number;
  label: string | null;
  region: string | null;
  province: string | null;
  city: string | null;
  barangay: string | null;
  address: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  is_default: boolean;
};

// backend UserAddressBase max_length values
export const ADDRESS_LIMITS = {
  label: 50, province: 100, city: 100, barangay: 100, address: 255, postal_code: 10,
} as const;

export type AddressFields = {
  label: string; address: string; barangay: string; city: string; province: string; postal_code: string;
};

export type AddressPayload = { [K in keyof AddressFields]: string | null };

/** "12 Rizal St, San Roque, Marikina, Metro Manila, 1800, Philippines" — the web checkout's line. */
export function addressLine(a: Pick<SavedAddress, 'address' | 'barangay' | 'city' | 'province' | 'postal_code'>): string {
  return [a.address, a.barangay, a.city, a.province, a.postal_code, 'Philippines']
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/** Short text for a list row or chip: "Home · 12 Rizal St · Marikina". */
export function addressSummary(a: SavedAddress): string {
  return [a.label, a.address, a.city].map((p) => (p ?? '').trim()).filter(Boolean).join(' · ') || `Address #${a.id}`;
}

/** The payload to save, or the first problem. Street, city and province are needed for delivery. */
export function checkAddress(f: AddressFields): { ok: AddressPayload } | { error: string } {
  const t = (k: keyof AddressFields) => f[k].trim();
  if (!t('address')) return { error: 'Enter the house number and street.' };
  if (!t('city')) return { error: 'Enter the city or municipality.' };
  if (!t('province')) return { error: 'Enter the province (or Metro Manila).' };
  for (const k of Object.keys(ADDRESS_LIMITS) as (keyof AddressFields)[]) {
    if (t(k).length > ADDRESS_LIMITS[k]) return { error: `${k.replace('_', ' ')} can have at most ${ADDRESS_LIMITS[k]} characters.` };
  }
  if (t('postal_code') && !/^\d{4}$/.test(t('postal_code'))) return { error: 'A postal code has 4 digits.' };
  const ok = {} as AddressPayload;
  for (const k of Object.keys(f) as (keyof AddressFields)[]) ok[k] = t(k) || null;
  return { ok };
}

/**
 * The address part of the place-order body. A saved address sends its region and map
 * pin too (the server checks the region is in Luzon); text the buyer typed or changed
 * sends the text only (the server then checks the province in it).
 */
export function deliveryFields(selected: SavedAddress | null, text: string): {
  delivery_address: string | null;
  delivery_region?: string;
  delivery_lat?: number;
  delivery_lng?: number;
} {
  const line = text.trim();
  if (selected && line === addressLine(selected)) {
    return {
      delivery_address: line || null,
      ...(selected.region ? { delivery_region: selected.region } : {}),
      ...(selected.lat != null && selected.lng != null ? { delivery_lat: selected.lat, delivery_lng: selected.lng } : {}),
    };
  }
  return { delivery_address: line || null };
}
