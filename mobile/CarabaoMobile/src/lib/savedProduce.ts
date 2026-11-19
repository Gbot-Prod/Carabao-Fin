// CF-0104: saved produce ids on the phone. `withSaved` is a copy of the web's
// frontend/carabao-app/lib/saved-produce.ts (CF-0038): keep the two in step.
// Pure, for `npm test`.

/** The id list after saving (added first) or unsaving one id. No duplicates. */
export function withSaved(ids: readonly number[], id: number, saved: boolean): number[] {
  const rest = ids.filter((existing) => existing !== id);
  return saved ? [id, ...rest] : rest;
}

// Which account the ids belong to: src/lib/ownedState.ts (CF-0108).
