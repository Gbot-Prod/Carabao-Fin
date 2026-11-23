// Merchant copy of mobile/CarabaoMobile/src/lib/farms.ts (ratingLabel only).
// CF-0111: the farm card on the browse screen, from GET /merchants (real data;
// replaces the type that lived in the old mockData.ts). Pure, for `npm test`.

/** "4.5" for a rated farm, "New" for a farm without reviews (not "0"). */
export function ratingLabel(rating: number | null | undefined): string {
  return typeof rating === 'number' && Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : 'New';
}
