/// <reference types="node" />
// Run with `npm test`. S19: the Home tab's setup checklist (web M/components/SetupChecklist.tsx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKLIST_ROUTES, itemRoute, setupChecklist, type ChecklistInput } from './setupChecklist.ts';
import { APPROVED_PUBLISH } from './application.ts';

const fresh: ChecklistInput = { status: 'setup', shopPage: null, productCount: 0, hasPayout: false };
const keys = ['contact', 'shop', 'product', 'payout', 'documents', 'approved', 'publish'];

test('a new farm sees all seven steps in the web order; only contact is done', () => {
  const c = setupChecklist(fresh)!;
  assert.deepEqual(c.items.map((i) => i.key), keys);
  assert.equal(c.doneCount, 1);
  assert.deepEqual(c.items.filter((i) => i.done).map((i) => i.key), ['contact']);
  assert.notEqual(c.sub, APPROVED_PUBLISH);
});

test('each open step opens the mobile screen that does it', () => {
  const c = setupChecklist(fresh)!;
  const route = Object.fromEntries(c.items.map((i) => [i.key, itemRoute(i)]));
  assert.deepEqual(route, {
    contact: null,
    shop: CHECKLIST_ROUTES.shop,
    product: '/(tabs)/produce',
    payout: '/earnings',
    documents: '/onboarding?step=business',
    approved: null,
    publish: null,
  });
});

test('done rules: logo and title, one product, a payout account', () => {
  const c = setupChecklist({
    ...fresh,
    shopPage: { is_published: false, draft_title: 'Farm', draft_logo_url: 'https://x/logo.png' },
    productCount: 1,
    hasPayout: true,
  })!;
  const done = (k: string) => c.items.find((i) => i.key === k)!.done;
  assert.ok(done('shop') && done('product') && done('payout'));
  assert.equal(itemRoute(c.items.find((i) => i.key === 'shop')!), null, 'a done step has no link');
  // A blank title or no logo is not drafted; loading payout is not done.
  const blank = setupChecklist({ ...fresh, shopPage: { is_published: false, draft_title: '  ', draft_logo_url: 'x' }, hasPayout: undefined })!;
  assert.equal(blank.items.find((i) => i.key === 'shop')!.done, false);
  assert.equal(blank.items.find((i) => i.key === 'payout')!.done, false);
});

test('review states: documents done, approval opens the application status', () => {
  const review = setupChecklist({ ...fresh, status: 'under_review' })!;
  const docs = review.items.find((i) => i.key === 'documents')!;
  const approval = review.items.find((i) => i.key === 'approved')!;
  assert.ok(docs.done);
  assert.equal(approval.detail, 'Under review');
  assert.equal(itemRoute(approval), '/application');

  const changes = setupChecklist({ ...fresh, status: 'needs_changes', adminNote: 'Upload a clearer ID' })!;
  const docs2 = changes.items.find((i) => i.key === 'documents')!;
  assert.equal(docs2.done, false);
  assert.equal(docs2.detail, 'Update them and submit again');
  assert.equal(itemRoute(docs2), '/onboarding?step=business');
  const approval2 = changes.items.find((i) => i.key === 'approved')!;
  assert.equal(approval2.detail, 'Changes requested');
  assert.equal(approval2.note, 'Upload a clearer ID');
  assert.equal(itemRoute(approval2), '/application');
  // The note shows only for needs_changes.
  assert.equal(setupChecklist({ ...fresh, status: 'under_review', adminNote: 'x' })!.items.find((i) => i.key === 'approved')!.note, null);
});

test('verified: publish opens the shop; published hides the checklist', () => {
  const c = setupChecklist({ ...fresh, status: 'verified' })!;
  const publish = c.items.find((i) => i.key === 'publish')!;
  assert.equal(publish.detail, APPROVED_PUBLISH);
  assert.equal(itemRoute(publish), '/shop');
  assert.equal(c.sub, APPROVED_PUBLISH);
  assert.equal(itemRoute(c.items.find((i) => i.key === 'approved')!), null);
  assert.equal(setupChecklist({ ...fresh, status: 'verified', shopPage: { is_published: true, draft_title: 'F', draft_logo_url: 'l' } }), null);
});
