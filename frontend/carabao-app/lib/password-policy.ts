// The rule for every new password (signup, reset, change). The server checks it
// too (lib/auth.ts passwordPolicy), so a client that skips the check is refused.
// Sign-in does not check it: it only compares the password with the stored one.
// Keep in step with mobile/CarabaoMobile/src/lib/passwordPolicy.ts.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULE_MESSAGE =
  "Use 8 to 128 characters, with an uppercase letter, a lowercase letter, a number and a symbol (for example ! ? # @).";

/** True when the password obeys the rule. */
export const isStrongPassword = (password: string): boolean =>
  password.length >= PASSWORD_MIN_LENGTH &&
  password.length <= PASSWORD_MAX_LENGTH &&
  /\p{Lu}/u.test(password) &&
  /\p{Ll}/u.test(password) &&
  /\p{Nd}/u.test(password) &&
  // A symbol: not a letter, not a digit, not a space.
  /[^\p{L}\p{N}\s]/u.test(password);
