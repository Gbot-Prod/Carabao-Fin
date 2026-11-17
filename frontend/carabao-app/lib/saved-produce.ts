// CF-0038: client-side bookkeeping for saved produce ids. Pure, for `npm test`.

/** The id list after saving (added first) or unsaving one id. No duplicates. */
export function withSaved(ids: readonly number[], id: number, saved: boolean): number[] {
  const rest = ids.filter((existing) => existing !== id);
  return saved ? [id, ...rest] : rest;
}
