// CF-0051 (B02): text limits the API enforces (422 above them). Kept in step
// with backend/app/schemas/produce.py and shopPage.py (SYSTEM_REFERENCE §3).
export const PRODUCE_NAME_MAX = 100;
export const PRODUCE_DESCRIPTION_MAX = 2000;
// backend listing_checks.MAX_PRICE_PER_KG (hard block on save).
export const PRODUCE_PRICE_PER_KG_MAX = 500;
export const SHOP_TITLE_MAX = 100;
export const SHOP_DESCRIPTION_MAX = 2000;
