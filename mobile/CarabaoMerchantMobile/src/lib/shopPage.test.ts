// S14 (plan §5.9): the shop page state the screen shows, and the slug check it runs before
// a save. The cases are the web Shop tab's PublishStatusBanner states.
/// <reference types="node" />
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canPublish,
  publishLabel,
  SHOP_DESCRIPTION_MAX,
  SHOP_SLUG_MAX,
  SHOP_SLUG_MIN,
  SHOP_TITLE_MAX,
  shopState,
  shopStateBadge,
  shopStateText,
  showsDiscard,
  slugProblem,
} from './shopPage.ts';
import type { ApiShopPage } from './api.ts';

/** The owner's page as the API sends it; a new page is a never-published draft. */
const page = (over: Partial<ApiShopPage> = {}): ApiShopPage => ({
  id: 1,
  merchant_id: 2,
  title: 'Dela Cruz Farm',
  slug: 'dela-cruz-farm',
  banner_image_url: null,
  logo_url: null,
  description: null,
  draft_title: 'Dela Cruz Farm',
  draft_description: null,
  draft_logo_url: null,
  draft_banner_image_url: null,
  published_at: null,
  is_published: false,
  has_unpublished_changes: true,
  ...over,
});

test('S14 the four states: unverified draft, approved draft, live changed, live', () => {
  assert.equal(shopState(page(), false), 'unverified');
  assert.equal(shopState(page(), true), 'draft');
  assert.equal(shopState(page({ is_published: true, has_unpublished_changes: true }), true), 'changed');
  assert.equal(shopState(page({ is_published: true, has_unpublished_changes: false }), true), 'live');
  // A live page stays "live" to buyers even if verification was lost; publish is refused.
  assert.equal(shopState(page({ is_published: true, has_unpublished_changes: false }), false), 'live');
});

test('S14 the chip and the sentence match the web banner', () => {
  assert.equal(shopStateBadge('unverified'), 'Not live');
  assert.equal(shopStateBadge('draft'), 'Not live');
  assert.equal(shopStateBadge('changed'), 'Unpublished changes');
  assert.equal(shopStateBadge('live'), 'Live');

  assert.match(shopStateText('unverified'), /^Buyers cannot see your farm yet\./);
  assert.equal(shopStateText('draft'), 'You’re approved — review your products and publish.');
  assert.equal(shopStateText('changed'), 'Buyers still see the live page. Publish to show your changes.');
  assert.match(shopStateText('live'), /^Buyers see this page\./);
});

test('S14 only a verified farm with a titled, changed draft can publish', () => {
  assert.equal(canPublish(page(), true), true);
  assert.equal(canPublish(page(), false), false);
  // Nothing to publish once the draft is the live page.
  assert.equal(canPublish(page({ is_published: true, has_unpublished_changes: false }), true), false);
  // A blank draft title fails the backend's 422, so the screen stops it first.
  assert.equal(canPublish(page({ draft_title: '   ' }), true), false);
});

test('S14 the publish button names the first publish and the later ones', () => {
  assert.equal(publishLabel(page()), 'Publish shop');
  assert.equal(publishLabel(page({ is_published: true })), 'Publish changes');
});

test('S14 Discard shows only for a live shop with unpublished changes', () => {
  // Never published: nothing to go back to (the backend answers 400).
  assert.equal(showsDiscard(page()), false);
  assert.equal(showsDiscard(page({ is_published: true, has_unpublished_changes: false })), false);
  assert.equal(showsDiscard(page({ is_published: true, has_unpublished_changes: true })), true);
});

test('S14 the slug check follows the backend rules', () => {
  for (const ok of ['dela-cruz-farm', 'farm1990', 'a1b', '12-34']) {
    assert.equal(slugProblem(ok), null, ok);
  }
  assert.match(String(slugProblem('ab')), /at least 3 characters/);
  assert.match(String(slugProblem('a'.repeat(SHOP_SLUG_MAX + 1))), /at most 80 characters/);
  for (const bad of ['Dela-Cruz-Farm', 'dela_cruz', 'dela--cruz', '-dela', 'dela-', 'dela cruz', 'dela.cruz']) {
    assert.ok(slugProblem(bad), bad);
  }
  // /farms/<number> is a farm id, so a slug of only digits can never be reached.
  assert.equal(slugProblem('123'), 'The shop link needs at least one letter.');
  assert.equal(slugProblem('  dela-cruz-farm  '), null);
});

test('S14 the field limits are the backend and web numbers', () => {
  // schemas/shopPage.py MAX_TITLE / MAX_DESCRIPTION; inStep.test.ts checks the files.
  assert.equal(SHOP_TITLE_MAX, 100);
  assert.equal(SHOP_DESCRIPTION_MAX, 2000);
  assert.equal(SHOP_SLUG_MIN, 3);
  assert.equal(SHOP_SLUG_MAX, 80);
});
