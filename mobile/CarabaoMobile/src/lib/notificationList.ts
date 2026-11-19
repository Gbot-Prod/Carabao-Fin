// CF-0121: the notification centre's list (web util/api/notifications.ts): paging,
// all / unread, and the local change a tap makes before the server answers.
// Pure, for `npm test`.

export type Note = { id: number; kind: string; title: string; body: string | null; link: string | null; read: boolean; created_at: string };

export const NOTES_PAGE = 30; // web default limit

export function notesQuery(unreadOnly: boolean, offset: number, limit = NOTES_PAGE): string {
  return `limit=${limit}&offset=${Math.max(0, Math.floor(offset) || 0)}&unread_only=${unreadOnly}`;
}

export type NoteAction =
  | { type: 'read'; id: number }
  | { type: 'unread'; id: number }
  | { type: 'delete'; id: number }
  | { type: 'readAll' }
  | { type: 'deleteRead' };

/**
 * The list after an action. In the Unread view a row that becomes read leaves the
 * list, as the server would leave it out on the next load.
 */
export function applyNoteAction(items: readonly Note[], action: NoteAction, unreadOnly: boolean): Note[] {
  switch (action.type) {
    case 'read':
      return unreadOnly
        ? items.filter((n) => n.id !== action.id)
        : items.map((n) => (n.id === action.id ? { ...n, read: true } : n));
    case 'unread':
      return items.map((n) => (n.id === action.id ? { ...n, read: false } : n));
    case 'delete':
      return items.filter((n) => n.id !== action.id);
    case 'readAll':
      return unreadOnly ? [] : items.map((n) => ({ ...n, read: true }));
    case 'deleteRead':
      return items.filter((n) => !n.read);
  }
}

/** The unread count after an action (never below 0). */
export function unreadAfter(count: number, items: readonly Note[], action: NoteAction): number {
  const target = 'id' in action ? items.find((n) => n.id === action.id) : undefined;
  switch (action.type) {
    case 'read':
      return target && !target.read ? Math.max(0, count - 1) : count;
    case 'unread':
      return target && target.read ? count + 1 : count;
    case 'delete':
      return target && !target.read ? Math.max(0, count - 1) : count;
    case 'readAll':
      return 0;
    case 'deleteRead':
      return count;
  }
}
