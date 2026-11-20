"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import OrderChat from "@/components/OrderChat/OrderChat";
import SkeletonList, { LoadError } from "@/components/Skeleton/Skeleton";
import { ORDER_STATUS_LABELS, inquiryEndpoint, type InquirySummary, type MerchantChatSummary } from "@/util/api";
import { useMerchant } from "../../MerchantContext";
import MerchantPage from "../../MerchantPage";
import s from "./chats.module.css";

function when(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

/** One row: a chat about an order, or a question a buyer asked before buying. */
type ChatItem =
  | { kind: "order"; key: string; chat: MerchantChatSummary }
  | { kind: "inquiry"; key: string; chat: InquirySummary };

const INQUIRY_TAG = "Question before buying";

/** Chats with buyers: the list on the left, the open chat on the right. */
export default function MerchantChatsPage() {
  const { chatsState } = useMerchant();
  const { chats, inquiries, loaded, error, reload, markRead, markInquiryRead } = chatsState;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedOrder = Number(params.get("order")) || null;
  const selectedInquiry = Number(params.get("inquiry")) || null;
  const selectedKey = selectedOrder
    ? `order-${selectedOrder}`
    : selectedInquiry
      ? `inquiry-${selectedInquiry}`
      : null;

  const items = useMemo<ChatItem[]>(() => {
    const all: ChatItem[] = [
      ...chats.map((chat) => ({ kind: "order" as const, key: `order-${chat.order_id}`, chat })),
      ...inquiries.map((chat) => ({ kind: "inquiry" as const, key: `inquiry-${chat.conversation_id}`, chat })),
    ];
    return all.sort((a, b) => Date.parse(b.chat.last_at) - Date.parse(a.chat.last_at));
  }, [chats, inquiries]);

  const selected = items.find((item) => item.key === selectedKey) ?? null;

  // The open chat reads its messages, and the server marks them read.
  useEffect(() => {
    if (!selected || selected.chat.unread === 0) return;
    if (selected.kind === "order") markRead(selected.chat.order_id);
    else markInquiryRead(selected.chat.conversation_id);
  }, [selected, markRead, markInquiryRead]);

  const open = (item: ChatItem | null) => {
    const query =
      item == null
        ? ""
        : item.kind === "order"
          ? `?order=${item.chat.order_id}`
          : `?inquiry=${item.chat.conversation_id}`;
    router.replace(`${pathname}${query}`, { scroll: false });
  };

  const unread = items.filter((item) => item.chat.unread > 0).length;

  return (
    <MerchantPage
      eyebrow="Sales"
      title="Chats"
      count={loaded ? items.length : undefined}
      description={
        unread > 0
          ? `${unread} chat${unread === 1 ? "" : "s"} with new messages. Buyers can ask you questions before they order, and message you about an order until 7 days after delivery.`
          : "Questions from buyers before they order, and messages about their orders. An order chat closes 7 days after delivery."
      }
    >
      {!loaded && error ? (
        <LoadError message={error} onRetry={() => void reload()} />
      ) : !loaded ? (
        <SkeletonList label="Loading chats…" rows={4} />
      ) : items.length === 0 ? (
        <div className={s.empty}>
          <MessagesSquare size={28} strokeWidth={1.5} aria-hidden="true" />
          <p>No chats yet. When a buyer asks you a question or messages you about an order, the chat shows here.</p>
          <p className={s.emptySub}>You can also start a chat from an order on the Orders page.</p>
        </div>
      ) : (
        <div className={`${s.layout} ${selected ? s.hasSelection : ""}`}>
          <ul className={s.list} aria-label="Chats">
            {items.map((item) => (
              <li key={item.key}>
                <ChatRow item={item} active={item.key === selectedKey} onOpen={() => open(item)} />
              </li>
            ))}
          </ul>

          <div className={s.thread}>
            {selected ? (
              <>
                <div className={s.threadHead}>
                  <button type="button" className={s.back} onClick={() => open(null)}>
                    ← All chats
                  </button>
                  <div className={s.threadTitle}>
                    <strong>{selected.chat.buyer_name ?? "Buyer"}</strong>
                    <span>
                      {selected.kind === "order"
                        ? `${selected.chat.order_ref} · ${ORDER_STATUS_LABELS[selected.chat.order_status] ?? selected.chat.order_status}`
                        : INQUIRY_TAG}
                    </span>
                  </div>
                </div>
                <div className={s.threadBody}>
                  {selected.kind === "order" ? (
                    <OrderChat key={selected.key} orderId={selected.chat.order_id} title="Messages" fill />
                  ) : (
                    <OrderChat
                      key={selected.key}
                      endpoint={inquiryEndpoint(selected.chat.conversation_id)}
                      title="Messages"
                      closedText="Your shop is not taking messages right now, so this chat is read-only."
                      fill
                    />
                  )}
                </div>
              </>
            ) : (
              <p className={s.pick}>Select a chat to read and reply.</p>
            )}
          </div>
        </div>
      )}
    </MerchantPage>
  );
}

function ChatRow({ item, active, onOpen }: { item: ChatItem; active: boolean; onOpen: () => void }) {
  const chat = item.chat;
  const unread = chat.unread > 0;
  return (
    <button
      type="button"
      className={`${s.row} ${active ? s.rowActive : ""} ${unread ? s.rowUnread : ""}`}
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
    >
      <span className={s.rowTop}>
        <span className={s.rowName}>{chat.buyer_name ?? "Buyer"}</span>
        <span className={s.rowTime}>{when(chat.last_at)}</span>
      </span>
      <span className={s.rowMeta}>
        {item.kind === "order" ? item.chat.order_ref : INQUIRY_TAG}
        {chat.closed && <span className={s.closedTag}>Closed</span>}
      </span>
      <span className={s.rowBottom}>
        <span className={s.rowPreview}>
          {chat.last_mine ? "You: " : ""}
          {chat.last_body}
        </span>
        {unread && (
          <span className={s.badge} aria-label={`${chat.unread} new`}>
            {chat.unread}
          </span>
        )}
      </span>
    </button>
  );
}
