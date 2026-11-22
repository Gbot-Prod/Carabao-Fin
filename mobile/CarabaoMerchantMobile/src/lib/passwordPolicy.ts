// Shared with mobile/CarabaoMobile/src/lib/passwordPolicy.ts. Keep both copies the same (sharedCopies.test.ts).
// The rule for every new password (signup, reset). The web server checks it too
// (frontend/carabao-app/lib/auth.ts passwordPolicy). Sign-in does not check it.
// Keep in step with frontend/carabao-app/lib/password-policy.ts.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULE_MESSAGE =
  'Use 8 to 128 characters, with an uppercase letter, a lowercase letter, a number and a symbol (for example ! ? # @).';

/** True when the password obeys the rule. */
export const isStrongPassword = (password: string): boolean =>
  password.length >= PASSWORD_MIN_LENGTH &&
  password.length <= PASSWORD_MAX_LENGTH &&
  /\p{Lu}/u.test(password) &&
  /\p{Ll}/u.test(password) &&
  /\p{Nd}/u.test(password) &&
  // A symbol: not a letter, not a digit, not a space.
  /[^\p{L}\p{N}\s]/u.test(password);
