// Merchant copy of mobile/CarabaoMobile/src/lib/orderDetail.ts - only the helpers the
// order chat uses. CF-0114: route values can come from a deep link: checked before use.
// Pure, for `npm test`.
import { INQUIRY_TAG } from './chatInbox.ts';

/**
 * An order ID or a conversation ID from a route or deep-link parameter, or null. Only a
 * plain positive whole number is accepted, so "1e3", "0x10", " 7", "7/../x" or arrays
 * never reach a URL. (S5: a pre-order question is addressed by its conversation id.)
 */
export function parseOrderId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * The thread the chat screen opens: the account's support chat (`support=1`), an order
 * chat (`orderId=<id>`) or the farm's side of a buyer's pre-order question
 * (`inquiry=<conversation_id>`, web merchant chats page). S5.
 */
export type ChatTarget =
  | { kind: 'support' }
  | { kind: 'order'; orderId: number }
  | { kind: 'inquiry'; conversationId: number };

/**
 * Which of the three threads a route names, or null when it names none (the screen then
 * says "Chat not found"). `support=1` wins, as before; an inquiry wins over an orderId
 * because the Chats tab sends only one of them. An invalid id is ignored, not repaired.
 */
export function chatTarget(
  orderIdRaw: string | string[] | undefined,
  inquiryRaw: string | string[] | undefined,
  isSupport: boolean,
): ChatTarget | null {
  if (isSupport) return { kind: 'support' };
  const conversationId = parseOrderId(inquiryRaw);
  if (conversationId !== null) return { kind: 'inquiry', conversationId };
  const orderId = parseOrderId(orderIdRaw);
  return orderId === null ? null : { kind: 'order', orderId };
}

/**
 * The messages endpoint for a thread: the same path reads (GET) and sends (POST), as on
 * the web (W/components/OrderChat/OrderChat.tsx `url`, W/util/api/merchants.ts
 * inquiryEndpoint). api.ts builds every chat call from this, so the three cannot drift.
 */
export function chatEndpoint(target: ChatTarget): string {
  switch (target.kind) {
    case 'support':
      return '/support/messages';
    case 'order':
      return `/orders/${target.orderId}/messages`;
    case 'inquiry':
      return `/inquiries/${target.conversationId}/messages`;
  }
}

/**
 * The chat screen's header. The app passes "Chat with <buyer>"; any other value from a
 * route (a deep link can set it) is replaced, so a link cannot make an order chat look
 * like "Carabao support" or carry a message. CF-0114. A question has no order number, so
 * it falls back to the web's tag for it (S5).
 */
export function chatTitle(raw: string | string[] | undefined, target: ChatTarget | null): string {
  if (target?.kind === 'support') return 'Carabao support';
  if (typeof raw === 'string' && /^Chat with [^\n\r]{1,80}$/.test(raw) && !/support/i.test(raw)) return raw;
  if (target?.kind === 'order') return `Order #${target.orderId}`;
  if (target?.kind === 'inquiry') return INQUIRY_TAG;
  return 'Chat';
}
