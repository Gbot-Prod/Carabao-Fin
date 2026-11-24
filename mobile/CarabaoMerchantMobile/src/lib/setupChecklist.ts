// src/lib/setupChecklist.ts
// S19 (plan §5.1): the "Get your shop live" steps on the Home tab. The items, their order,
// the done rules and the words are the web's (M/components/SetupChecklist.tsx); each step
// that the farm can do now has the mobile route that does it. inStep.test.ts reads the web
// file. Pure (type-only imports), for `npm test`.
import type { ApiShopPage } from './api.ts';
import { APPLICATION_WORDS, APPROVED_PUBLISH, BUSINESS_STEP_PATH, SHOP_PATH, SUSPENDED_TITLE } from './application.ts';

/** The mobile routes the steps open (decision D2). */
export const CHECKLIST_ROUTES = {
  shop: SHOP_PATH,
  produce: '/(tabs)/produce',
  earnings: '/earnings',
  documents: BUSINESS_STEP_PATH,
  application: '/application',
} as const;

export type ChecklistRoute = (typeof CHECKLIST_ROUTES)[keyof typeof CHECKLIST_ROUTES];

export type ChecklistItem = {
  key: 'contact' | 'shop' | 'product' | 'payout' | 'documents' | 'approved' | 'publish';
  label: string;
  done: boolean;
  /** Where the step is done; none for a step the farm cannot do yet. Shown only while not done. */
  route?: ChecklistRoute;
  detail?: string;
  /** The admin's notes when Carabao asked for changes; shown as "Carabao: …". */
  note?: string | null;
};

export const CHECKLIST_WORDS = {
  title: 'Get your shop live',
  sub: 'You can set everything up now. Buyers see your shop once Carabao approves it and you publish.',
  contact: 'Contact details verified',
  shop: 'Shop page drafted',
  shopDetail: 'Title and logo set',
  product: 'At least one product added',
  payout: 'Payout account added',
  documents: 'Business documents submitted',
  documentsAgain: 'Update them and submit again',
  underReview: 'Under review',
  afterSubmit: 'After you submit your business documents',
  publish: 'Publish your shop',
  publishLater: 'Available once your documents are approved.',
} as const;

export type ChecklistInput = {
  /** performance.verification_status. */
  status: string | null | undefined;
  shopPage: Pick<ApiShopPage, 'is_published' | 'draft_title' | 'draft_logo_url'> | null;
  productCount: number;
  /** undefined while loading, false when no payout account is set up. */
  hasPayout: boolean | undefined;
  /** The application's admin_note, read only when Carabao asked for changes. */
  adminNote?: string | null;
};

export type Checklist = { items: ChecklistItem[]; doneCount: number; sub: string };

/** The checklist, or null once the shop page is published (the web hides it then). */
export function setupChecklist({ status, shopPage, productCount, hasPayout, adminNote }: ChecklistInput): Checklist | null {
  if (shopPage?.is_published) return null;

  const verified = status === 'verified';
  const submitted = status === 'under_review' || verified || status === 'suspended';
  const approval: ChecklistItem = {
    key: 'approved',
    label: APPLICATION_WORDS.approved,
    done: verified,
    detail:
      status === 'under_review'
        ? CHECKLIST_WORDS.underReview
        : status === 'needs_changes'
          ? APPLICATION_WORDS.changesRequested
          : status === 'suspended'
            ? SUSPENDED_TITLE
            : verified
              ? undefined
              : CHECKLIST_WORDS.afterSubmit,
    note: status === 'needs_changes' ? adminNote : null,
    // The web has no link here; the phone opens the application status (S18), which shows
    // the review state and the admin's notes in full.
    route: submitted || status === 'needs_changes' ? CHECKLIST_ROUTES.application : undefined,
  };

  const items: ChecklistItem[] = [
    { key: 'contact', label: CHECKLIST_WORDS.contact, done: true },
    {
      key: 'shop',
      label: CHECKLIST_WORDS.shop,
      detail: CHECKLIST_WORDS.shopDetail,
      done: Boolean(shopPage?.draft_title?.trim() && shopPage?.draft_logo_url),
      route: CHECKLIST_ROUTES.shop,
    },
    { key: 'product', label: CHECKLIST_WORDS.product, done: productCount > 0, route: CHECKLIST_ROUTES.produce },
    { key: 'payout', label: CHECKLIST_WORDS.payout, done: hasPayout === true, route: CHECKLIST_ROUTES.earnings },
    {
      key: 'documents',
      label: CHECKLIST_WORDS.documents,
      done: submitted,
      detail: status === 'needs_changes' ? CHECKLIST_WORDS.documentsAgain : undefined,
      route: submitted ? undefined : CHECKLIST_ROUTES.documents,
    },
    approval,
    {
      key: 'publish',
      label: CHECKLIST_WORDS.publish,
      done: false,
      detail: verified ? APPROVED_PUBLISH : CHECKLIST_WORDS.publishLater,
      route: verified ? CHECKLIST_ROUTES.shop : undefined,
    },
  ];
  return {
    items,
    doneCount: items.filter((i) => i.done).length,
    sub: verified ? APPROVED_PUBLISH : CHECKLIST_WORDS.sub,
  };
}

/** The route a row opens, or null when the row is done or has nowhere to go (web: no link then). */
export const itemRoute = (item: ChecklistItem): ChecklistRoute | null => (item.route && !item.done ? item.route : null);
