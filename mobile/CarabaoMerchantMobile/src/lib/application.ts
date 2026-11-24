// src/lib/application.ts
// S18 (plan §5.12): what the application status screen shows. The words are the web's
// (merchant/lib/verification.ts currentStep, merchant/onboarding/page.tsx success card,
// merchant/components/SetupChecklist.tsx and VerificationBanner.tsx); the status map is the
// backend's (models/statuses.py APPLICATION_TO_VERIFICATION). inStep.test.ts reads those files.
// Pure, so `npm test` covers it.
import type { ApiMerchantApplication } from './api.ts';

export type VerificationStatus = 'setup' | 'under_review' | 'needs_changes' | 'verified' | 'suspended';

/** merchant_applications.status -> merchants.verification_status (backend statuses.py). */
export const APPLICATION_TO_VERIFICATION: Record<string, VerificationStatus> = {
  pending_documents: 'setup',
  submitted: 'under_review',
  clarification: 'needs_changes',
  rejected: 'needs_changes',
  approved: 'verified',
  suspended: 'suspended',
};

/** The onboarding business step, pre-filled from the saved application (web BUSINESS_STEP_PATH). */
export const BUSINESS_STEP_PATH = '/onboarding?step=business';
export const SHOP_PATH = '/shop';

export const APPROVED_PUBLISH = "You're approved — review your products and publish.";

/** The step the banner names while the shop is not live (web currentStep, same words). */
export function currentStep(status: VerificationStatus): { text: string; action?: { label: string; path: string } } {
  switch (status) {
    case 'setup':
      return {
        text: 'Next: add your business information so Carabao can review it.',
        action: { label: 'Add business information', path: BUSINESS_STEP_PATH },
      };
    case 'under_review':
      return { text: 'Carabao is reviewing your documents. You can keep setting up your shop.' };
    case 'needs_changes':
      return {
        text: 'Carabao asked for changes to your business information.',
        action: { label: 'Review and resubmit', path: BUSINESS_STEP_PATH },
      };
    case 'suspended':
      return { text: 'Your shop is suspended, so buyers cannot see it. Contact Carabao support.' };
    default:
      return { text: APPROVED_PUBLISH, action: { label: 'Go to Shop', path: SHOP_PATH } };
  }
}

/** The web words this screen uses. */
export const APPLICATION_WORDS = {
  savedTitle: 'Application saved',
  submittedTitle: 'Application submitted',
  savedText:
    'Your Merchant Centre is ready: set up your shop and add produce now. Finish your business '
    + 'information when you have your documents; your shop goes live once Carabao approves them.',
  submittedText:
    'Your application is now set for review. Meanwhile, set up your shop and add produce in the '
    + 'Merchant Centre; you can publish once it is approved.',
  // SetupChecklist approval details.
  changesRequested: 'Changes requested',
  approved: 'Approved by Carabao',
  notLive: "Your shop isn't live yet.",
  goToCentre: 'Go to Merchant Centre',
  // The old Plan 1 hand-off, kept as a fallback (S18 step 5).
  continueOnWeb: 'Continue on the web',
  notePrefix: 'Carabao: ',
  loadFailed: 'Could not load your application. Check your connection and try again.',
  tryAgain: 'Try again',
} as const;

/** The SetupChecklist detail for a suspended merchant. */
export const SUSPENDED_TITLE = 'Suspended. Contact Carabao support.';

export type ApplicationView = {
  status: VerificationStatus;
  title: string;
  /** The web success text after a save or a submit, else null. */
  intro: string | null;
  step: ReturnType<typeof currentStep>;
  /** The admin's notes, only when Carabao asked for changes (web SetupChecklist). */
  note: string | null;
};

/** What the status screen shows for an application, or null for a status the app does not know. */
export function applicationView(app: Pick<ApiMerchantApplication, 'status' | 'admin_note'>): ApplicationView | null {
  const status = APPLICATION_TO_VERIFICATION[app.status];
  if (!status) return null;
  const note = status === 'needs_changes' && app.admin_note?.trim() ? app.admin_note.trim() : null;
  const title =
    status === 'setup' ? APPLICATION_WORDS.savedTitle
      : status === 'under_review' ? APPLICATION_WORDS.submittedTitle
        : status === 'needs_changes' ? APPLICATION_WORDS.changesRequested
          : status === 'verified' ? APPLICATION_WORDS.approved
            : SUSPENDED_TITLE;
  const intro =
    status === 'setup' ? APPLICATION_WORDS.savedText
      : status === 'under_review' ? APPLICATION_WORDS.submittedText
        : null;
  return { status, title, intro, step: currentStep(status), note };
}

/**
 * Whether /onboarding opens on the status first (S18 step 5): an application exists and the
 * link does not ask for the business step. `?step=business` opens the form at once, as on the web.
 */
export const showStatusFirst = (app: unknown, step: string | string[] | undefined): boolean =>
  app != null && (Array.isArray(step) ? step[0] : step) !== 'business';
