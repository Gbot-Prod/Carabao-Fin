// Feature switches for features that are built but turned off for now.
// They default to off; set the env var to "true" to bring one back.
// NEXT_PUBLIC_ so the value is the same on the server and in the browser.
// Two-step verification has no switch: it is for admins only, and admins
// must have it (CF-0003).

/** L1 English/Filipino toggle. While off the UI is English only. */
export const LANGUAGE_TOGGLE_ENABLED = process.env.NEXT_PUBLIC_FEATURE_LANGUAGE_TOGGLE === "true";
