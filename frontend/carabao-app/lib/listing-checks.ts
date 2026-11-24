// Guardrails Phase 1: show the listing checker's results under each form field.
// The checker is the backend's (services/listing_checks.py): the form calls
// POST /produce/check while the merchant types, and the save runs it again.
// Pure, for `npm test`.
import type { ListingIssue, ListingStanding, Produce, ProduceCheckResult } from "../util/api/produce.ts";

/** What one field shows: blocks stop the save, flags send it for review. */
export type FieldNote = { blocks: string[]; flags: ListingIssue[] };
export type FieldNotes = Record<string, FieldNote>;

/** The wait after the last key press before the form is checked. */
export const CHECK_DELAY_MS = 400;

function add(notes: FieldNotes, field: string): FieldNote {
  notes[field] ??= { blocks: [], flags: [] };
  return notes[field];
}

/**
 * The checker's result and the save's refusal ({field: message}, FieldErrors)
 * per field. A save refusal is newer than the last check, so its message is
 * shown first; the same text is shown once.
 */
export function notesByField(
  result: ProduceCheckResult | null,
  saveErrors: Record<string, string> = {},
): FieldNotes {
  const notes: FieldNotes = {};
  for (const [field, message] of Object.entries(saveErrors)) {
    if (message.trim()) add(notes, field).blocks.push(message.trim());
  }
  for (const issue of result?.hard_blocks ?? []) {
    const note = add(notes, issue.field);
    if (!note.blocks.some((m) => m.includes(issue.message))) note.blocks.push(issue.message);
  }
  for (const issue of result?.soft_flags ?? []) {
    add(notes, issue.field).flags.push(issue);
  }
  return notes;
}

/** Whether any field has a hard block (the save would be refused). */
export function hasBlocks(notes: FieldNotes): boolean {
  return Object.values(notes).some((n) => n.blocks.length > 0);
}

/** Messages for fields the form has no place for, so none is lost. */
export function unplacedMessages(notes: FieldNotes, formFields: readonly string[]): string[] {
  return Object.entries(notes)
    .filter(([field]) => !formFields.includes(field))
    .flatMap(([, note]) => [...note.blocks, ...note.flags.map((f) => f.message)]);
}

export type StatusNote = { tone: "review" | "rejected"; text: string };

/** The line a merchant's own listing shows about its review state. */
export function statusNote(p: Pick<Produce, "status" | "rejection_reason">): StatusNote | null {
  if (p.status === "under_review") {
    return {
      tone: "review",
      text: "Under review: an admin checks this listing within 24 hours. Buyers can still see and order it.",
    };
  }
  if (p.status === "rejected") {
    const reason = p.rejection_reason?.trim();
    return {
      tone: "rejected",
      text: `Not approved${reason ? `: ${reason}` : "."} Buyers cannot see it. Edit and save it to send it again.`,
    };
  }
  return null;
}

/** The message after a save, from the status the server gave the listing. */
export function savedMessage(status: Produce["status"]): string | null {
  return status === "under_review"
    ? "Saved. An admin will check this listing within 24 hours. Buyers can see it in the meantime."
    : null;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export type StandingNote = { tone: "info" | "warning" | "blocked"; lines: string[] };

/**
 * Guardrails Phase 2: what the produce page says about penalty points and the
 * new-farm review. Null when there is nothing to say.
 */
export function standingNote(s: ListingStanding | null): StandingNote | null {
  if (!s) return null;
  const lines: string[] = [];
  if (s.points > 0) {
    lines.push(
      `You have ${s.points} penalty point${s.points === 1 ? "" : "s"} (from listings an admin did not approve in the last ${s.window_days} days).`,
    );
    for (const p of s.penalties) {
      lines.push(`${p.produce_name}: ${p.label} ${p.points} point${p.points === 1 ? "" : "s"}, until ${shortDate(p.expires_at)}.`);
    }
  }
  if (!s.can_create_listings) {
    lines.push(
      `You cannot make new listings${s.blocked_until ? ` until ${shortDate(s.blocked_until)}` : ""}. You can still edit your current listings.`,
    );
  } else if (s.points > 0) {
    lines.push(`At ${s.listing_block_points} points you cannot make new listings.`);
  }
  if (s.new_merchant_reviews_left > 0) {
    lines.push(
      `New farm: an admin checks your listings until ${s.new_merchant_reviews_left} more ${s.new_merchant_reviews_left === 1 ? "is" : "are"} approved. Buyers can see them during the check.`,
    );
  }
  if (lines.length === 0) return null;
  const tone = !s.can_create_listings ? "blocked" : s.points > 0 ? "warning" : "info";
  return { tone, lines };
}
