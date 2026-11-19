// CF-0108: per-account state in memory (cart, saved ids) belongs to one user ID.
// After sign-out, idle sign-out, a refused session or an account switch it is not
// shown and is wiped, so the next person on a shared phone never sees it.
// Keyed by user ID, not by token: the token is refreshed during a session.
// Pure, for `npm test`.

export type Owned<T> = { owner: string; value: T } | null;

/** The value for the signed-in user, or `empty` (signed out, other user, not loaded). */
export function valueFor<T>(state: Owned<T>, owner: string | null, empty: T): T {
  return owner !== null && state?.owner === owner ? state.value : empty;
}

/** True when the state in memory belongs to someone other than `owner` and must be wiped. */
export function mustWipe<T>(state: Owned<T>, owner: string | null): boolean {
  return state !== null && state.owner !== owner;
}

/** Apply a change for `owner`, starting from empty if the state was someone else's. Signed out: no state. */
export function updateFor<T>(state: Owned<T>, owner: string | null, empty: T, change: (value: T) => T): Owned<T> {
  if (owner === null) return null;
  return { owner, value: change(valueFor(state, owner, empty)) };
}
