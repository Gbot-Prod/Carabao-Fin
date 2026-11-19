// CF-0127: the merchant's chat inbox (GET /merchants/me/chats, backend ChatSummary;
// web merchant shell "chats"). Pure, for `npm test`.

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

/** Unread first, then the newest message first; closed chats after open ones with the same unread state. */
export function sortInbox(rows: readonly ChatSummary[]): ChatSummary[] {
  return [...rows].sort((a, b) => {
    const ua = a.unread > 0 ? 1 : 0;
    const ub = b.unread > 0 ? 1 : 0;
    if (ua !== ub) return ub - ua;
    if (a.closed !== b.closed) return a.closed ? 1 : -1;
    return Date.parse(b.last_at) - Date.parse(a.last_at) || b.order_id - a.order_id;
  });
}

/** One line: "You: Thanks!" or "Will it arrive by 5?", line breaks folded, cut with "…". */
export function preview(row: Pick<ChatSummary, 'last_body' | 'last_mine'>, max = 80): string {
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

/** The chat header the order chat screen accepts (orderDetail.chatTitle: "Chat with …"). */
export function inboxChatTitle(row: Pick<ChatSummary, 'buyer_name' | 'order_ref'>): string {
  const who = (row.buyer_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `Chat with ${who || `buyer of ${row.order_ref}`}`;
}

export const totalUnread = (rows: readonly ChatSummary[]): number => rows.reduce((n, r) => n + Math.max(0, r.unread), 0);
