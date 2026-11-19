// CF-0122: delete my account (web profile danger zone; backend POST
// /users/me/delete-code then DELETE /users/me with the texted code).
// Bounds = backend schemas/user.py. Pure, for `npm test`.

export const DELETE_PASSWORD_MAX = 128; // AccountDeleteCodeRequest.password
export const DELETE_CODE_MIN = 4; // AccountDeleteConfirm.code
export const DELETE_CODE_MAX = 10;
/** What the buyer types to say they mean it (before any code is sent). */
export const CONFIRM_WORD = 'DELETE';

/** The body for POST /users/me/delete-code: a blank password is sent as null (accounts without one). */
export function codeRequestBody(password: string): { password: string | null } | { error: string } {
  if (password.length > DELETE_PASSWORD_MAX) return { error: `A password has at most ${DELETE_PASSWORD_MAX} characters.` };
  return { password: password === '' ? null : password };
}

/** The typed code without spaces, or the problem. */
export function checkDeleteCode(raw: string): { code: string } | { error: string } {
  const code = raw.replace(/\s+/g, '');
  if (!/^\d+$/.test(code) || code.length < DELETE_CODE_MIN || code.length > DELETE_CODE_MAX) {
    return { error: 'Enter the code from the text message.' };
  }
  return { code };
}

/** True when the confirm word was typed (any case, spaces trimmed). */
export function confirmed(typed: string): boolean {
  return typed.trim().toUpperCase() === CONFIRM_WORD;
}

/** "the number ending in 1234" from the backend's last-4 `sent_to`. */
export function sentToText(sentTo: string): string {
  const last = sentTo.replace(/\D/g, '').slice(-4);
  return last ? `the number ending in ${last}` : 'your mobile number';
}
