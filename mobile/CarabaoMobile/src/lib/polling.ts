// CF-0117: when a screen may poll the API. A stack screen stays mounted under the
// next one and a tab stays mounted when another tab is shown, so "mounted" is not
// enough: poll only while the screen is in view and the app is in the foreground
// (same idea as the web's CF-0047 for hidden tabs). Pure, for `npm test`.

export type AppStateName = 'active' | 'background' | 'inactive' | 'unknown' | 'extension' | string;

export function shouldPoll(focused: boolean, appState: AppStateName, enabled = true): boolean {
  return enabled && focused && appState === 'active';
}

/** True when polling starts again after a pause: fetch at once instead of waiting a full interval. */
export function resumed(before: boolean, now: boolean): boolean {
  return !before && now;
}

/** The query for the bell: the unread count only (backend returns `unread` with any page). */
export const UNREAD_COUNT_QUERY = 'unread_only=true&limit=1';
