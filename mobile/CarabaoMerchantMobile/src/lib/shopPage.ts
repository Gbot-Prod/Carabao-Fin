// S14 (plan §5.9): the shop page's state and field rules, shared by ShopScreen.tsx and
// its tests. The state wording is the web Shop tab's PublishStatusBanner
// (merchant/components/ShopTab.tsx); the limits and the slug rules are the backend's
// (schemas/shopPage.py). inStep.test.ts keeps the two sides in step.
// Pure (no React Native imports), for `npm test`.
import type { ApiShopPage } from './api';

// backend MAX_TITLE / MAX_DESCRIPTION = web SHOP_TITLE_MAX / SHOP_DESCRIPTION_MAX.
export const SHOP_TITLE_MAX = 50;
export const SHOP_DESCRIPTION_MAX = 2000;
// backend MIN_SLUG / MAX_SLUG / SLUG_PATTERN (CF-0043): lowercase words joined by hyphens,
// so a slug is safe in /farms/<slug> and cannot imitate one.
export const SHOP_SLUG_MIN = 3;
export const SHOP_SLUG_MAX = 80;
export const SHOP_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type PublishState = Pick<ApiShopPage, 'is_published' | 'has_unpublished_changes'>;

/**
 * What buyers see: never published and not approved yet (`unverified`), never published
 * but approved (`draft`), live with edits waiting (`changed`), or live as edited (`live`).
 * A page that was never published reports `has_unpublished_changes` (backend model).
 */
export type ShopState = 'unverified' | 'draft' | 'changed' | 'live';

export function shopState(page: PublishState, verified: boolean): ShopState {
  if (!page.is_published) return verified ? 'draft' : 'unverified';
  return page.has_unpublished_changes ? 'changed' : 'live';
}

/** The chip: "Not live", "Unpublished changes" or "Live" (web badge). */
export function shopStateBadge(state: ShopState): string {
  if (state === 'live') return 'Live';
  return state === 'changed' ? 'Unpublished changes' : 'Not live';
}

/** The sentence under the chip. APPROVED_PUBLISH is the web merchant/lib/verification.ts text. */
export function shopStateText(state: ShopState): string {
  switch (state) {
    case 'unverified':
      return 'Buyers cannot see your farm yet. Set up your page now; you can publish once Carabao approves your documents.';
    case 'draft':
      return 'You’re approved — review your products and publish.';
    case 'changed':
      return 'Buyers still see the live page. Publish to show your changes.';
    default:
      return 'Buyers see this page. Your next edits stay in a draft until you publish.';
  }
}

/**
 * Publishing copies the draft to the live page. Only a verified farm may (the backend
 * answers 403 otherwise), the draft needs a title, and there must be something to publish.
 */
export function canPublish(page: PublishState & Pick<ApiShopPage, 'draft_title'>, verified: boolean): boolean {
  return verified && page.has_unpublished_changes && page.draft_title.trim().length > 0;
}

/** "Publish shop" before the first publish, "Publish changes" after (web button label). */
export function publishLabel(page: Pick<ApiShopPage, 'is_published'>): string {
  return page.is_published ? 'Publish changes' : 'Publish shop';
}

/** Discard copies the live page back to the draft: it needs a live page and a changed draft. */
export function showsDiscard(page: PublishState): boolean {
  return page.is_published && page.has_unpublished_changes;
}

/** Why the shop link cannot be saved, or null. The backend refuses the same slugs. */
export function slugProblem(slug: string): string | null {
  const value = slug.trim();
  if (value.length < SHOP_SLUG_MIN) return `The shop link needs at least ${SHOP_SLUG_MIN} characters.`;
  if (value.length > SHOP_SLUG_MAX) return `The shop link can be at most ${SHOP_SLUG_MAX} characters.`;
  if (!SHOP_SLUG_PATTERN.test(value)) {
    return 'Use lowercase letters, numbers and single hyphens, for example dela-cruz-farm.';
  }
  // A slug of only digits would read as a farm id in /farms/<slug> (backend field_validator).
  if (/^\d+$/.test(value)) return 'The shop link needs at least one letter.';
  return null;
}
