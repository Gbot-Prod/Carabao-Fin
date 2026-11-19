// CF-0111: the farm card on the browse screen, from GET /merchants (real data;
// replaces the type that lived in the old mockData.ts). Pure, for `npm test`.

export interface Farm {
  id: string;
  name: string;
  category: string;
  location: string;
  description: string;
  /** Average review rating, or null when the farm has no reviews yet. */
  rating: number | null;
  /** Delivery time in days, or null when the farm has not set it. */
  deliveryDays: number | null;
  /** Delivery fee in pesos, or null when the farm has not set it. */
  deliveryFee: number | null;
  operatingHours: string;
  contactInfo: string | null;
  /** Shop banner URL, or null: the card then shows a plain placeholder (no hot-linked stock photo). */
  image: string | null;
}

/** "4.5" for a rated farm, "New" for a farm without reviews (not "0"). */
export function ratingLabel(rating: number | null | undefined): string {
  return typeof rating === 'number' && Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : 'New';
}

/** "1 day", "3 days", or null when unknown (the card leaves it out). */
export function deliveryTimeLabel(days: number | null | undefined): string | null {
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return null;
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** "₱50 delivery", "Free delivery", or null when the farm has not set a fee. */
export function deliveryFeeLabel(fee: number | null | undefined): string | null {
  if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0) return null;
  return fee === 0 ? 'Free delivery' : `₱${fee.toLocaleString('en-PH')} delivery`;
}
