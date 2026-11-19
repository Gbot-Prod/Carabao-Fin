// CF-0104: saved produce ids on the phone. `withSaved` is a copy of the web's
// frontend/carabao-app/lib/saved-produce.ts (CF-0038): keep the two in step.
// Pure, for `npm test`.

/** The id list after saving (added first) or unsaving one id. No duplicates. */
export function withSaved(ids: readonly number[], id: number, saved: boolean): number[] {
  const rest = ids.filter((existing) => existing !== id);
  return saved ? [id, ...rest] : rest;
}

// ---- mobile only ----

/**
 * The ids to show for the signed-in account. The list is stored with the token it
 * was loaded for, so after sign-out or an account switch no old hearts show.
 */
export function idsFor(
  loaded: { token: string; ids: readonly number[] } | null,
  token: string | null,
): readonly number[] {
  return token && loaded?.token === token ? loaded.ids : [];
}
