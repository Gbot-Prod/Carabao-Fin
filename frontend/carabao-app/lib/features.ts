// Feature switches for features that are built but turned off for now.
// Both default to off; set the env var to "true" to bring one back.
// NEXT_PUBLIC_ so the value is the same on the server and in the browser.

/** E8 two-step verification. Keep in step with the backend's TWO_FACTOR_ENABLED. */
export const TWO_FACTOR_ENABLED = process.env.NEXT_PUBLIC_FEATURE_TWO_FACTOR === "true";

/** L1 English/Filipino toggle. While off the UI is English only. */
export const LANGUAGE_TOGGLE_ENABLED = process.env.NEXT_PUBLIC_FEATURE_LANGUAGE_TOGGLE === "true";
