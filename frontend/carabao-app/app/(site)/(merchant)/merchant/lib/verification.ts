import type { MerchantVerificationStatus } from "@/util/api";
import { MERCHANT_PAGES as P } from "@/lib/merchant-links";

/**
 * The Merchant Centre opens as soon as onboarding step 1 is saved; selling
 * needs Carabao's approval (backend services/merchant_verification.py).
 */

/** The onboarding business step, pre-filled from the saved application. */
export const BUSINESS_STEP_PATH = `${P.onboarding}?step=business`;


export const APPROVED_PUBLISH = "You're approved — review your products and publish.";

/** The step the banner names while the shop is not live. */
export function currentStep(status: MerchantVerificationStatus): { text: string; action?: { label: string; path: string } } {
  switch (status) {
    case "setup":
      return {
        text: "Next: add your business information so Carabao can review it.",
        action: { label: "Add business information", path: BUSINESS_STEP_PATH },
      };
    case "under_review":
      return { text: "Carabao is reviewing your documents. You can keep setting up your shop." };
    case "needs_changes":
      return {
        text: "Carabao asked for changes to your business information.",
        action: { label: "Review and resubmit", path: BUSINESS_STEP_PATH },
      };
    case "suspended":
      return { text: "Your shop is suspended, so buyers cannot see it. Contact Carabao support." };
    default:
      return { text: APPROVED_PUBLISH, action: { label: "Go to Shop", path: P.shop } };
  }
}
