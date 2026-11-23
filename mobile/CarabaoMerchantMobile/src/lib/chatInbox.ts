// CF-0127 + S5: the merchant's chat inbox (GET /merchants/me/chats and
// GET /merchants/me/inquiries, backend ChatSummary / InquirySummary; web merchant shell
// "chats"). Both lists sort and preview the same way, so the helpers are shared.
// Pure, for `npm test`.

export type ChatSummary = {
  order_id: number;
  order_ref: string;
  order_status: string;
  buyer_name: string | null;
  closed: boolean;
  last_body: string;
  last_sender_role: string;
  last_mine: boolean;
  last_at: string;
  unread: number;
};

/** A question a buyer asked the farm before (or without) ordering (S5, backend InquirySummary). */
export type InquirySummary = {
  conversation_id: number;
  merchant_id: number;
  farm_name: string | null;
  farm_logo_url: string | null;
  buyer_name: string | null;
  closed: boolean;
  last_body: string;
  last_sender_role: string;
  last_mine: boolean;
  last_at: string;
  unread: number;
};

/** The web chats page's row tag for a question, and the chat screen's header (S5). */
export const INQUIRY_TAG = 'Question before buying';

/** What a row needs to sort: unread state, whether it is closed, and when it last moved. */
type InboxRow = { unread: number; closed: boolean; last_at: string };

/** Unread first, then the newest message first; closed chats after open ones with the same unread state. */
export function sortInbox<T extends InboxRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ua = a.unread > 0 ? 1 : 0;
    const ub = b.unread > 0 ? 1 : 0;
    if (ua !== ub) return ub - ua;
    if (a.closed !== b.closed) return a.closed ? 1 : -1;
    return Date.parse(b.last_at) - Date.parse(a.last_at);
  });
}

/** One line: "You: Thanks!" or "Will it arrive by 5?", line breaks folded, cut with "…". */
export function preview(row: { last_body: string; last_mine: boolean }, max = 80): string {
  const text = row.last_body.replace(/\s+/g, ' ').trim();
  const cut = text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  return row.last_mine ? `You: ${cut}` : cut;
}

/** "now", "5 min", "3 h", "2 d", then the date. */
export function sinceLabel(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d`;
  return new Date(t).toISOString().slice(0, 10);
}

/** The chat header the order chat screen accepts (orderChat.chatTitle: "Chat with …"). */
export function inboxChatTitle(row: Pick<ChatSummary, 'buyer_name' | 'order_ref'>): string {
  const who = (row.buyer_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `Chat with ${who || `buyer of ${row.order_ref}`}`;
}

/** The same header for a question: there is no order reference to fall back to (S5). */
export function inquiryChatTitle(row: Pick<InquirySummary, 'buyer_name'>): string {
  const who = (row.buyer_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `Chat with ${who || 'a buyer'}`;
}

export const totalUnread = (rows: readonly { unread: number }[]): number =>
  rows.reduce((n, r) => n + Math.max(0, r.unread), 0);
