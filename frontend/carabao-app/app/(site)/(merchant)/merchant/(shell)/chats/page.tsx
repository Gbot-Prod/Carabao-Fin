"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import OrderChat from "@/components/OrderChat/OrderChat";
import SkeletonList, { LoadError } from "@/components/Skeleton/Skeleton";
import { ORDER_STATUS_LABELS, type MerchantChatSummary } from "@/util/api";
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

/** Order chats with buyers: the list on the left, the open chat on the right. */
export default function MerchantChatsPage() {
  const { chatsState } = useMerchant();
  const { chats, loaded, error, reload, markRead } = chatsState;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = Number(params.get("order")) || null;
  const selected = chats.find((c) => c.order_id === selectedId) ?? null;

  // The open chat reads its messages, and the server marks them read.
  useEffect(() => {
    if (selected && selected.unread > 0) markRead(selected.order_id);
  }, [selected, markRead]);

  const open = (orderId: number | null) => {
    router.replace(orderId ? `${pathname}?order=${orderId}` : pathname, { scroll: false });
  };

  const unread = chats.filter((c) => c.unread > 0).length;

  return (
    <MerchantPage
      eyebrow="Sales"
      title="Chats"
      count={loaded ? chats.length : undefined}
      description={
        unread > 0
          ? `${unread} chat${unread === 1 ? "" : "s"} with new messages. Buyers can message you about an order until 7 days after delivery.`
          : "Messages from buyers about their orders. A chat closes 7 days after delivery."
      }
    >
      {!loaded && error ? (
        <LoadError message={error} onRetry={() => void reload()} />
      ) : !loaded ? (
        <SkeletonList label="Loading chats…" rows={4} />
      ) : chats.length === 0 ? (
        <div className={s.empty}>
          <MessagesSquare size={28} strokeWidth={1.5} aria-hidden="true" />
          <p>No chats yet. When a buyer messages you about an order, the chat shows here.</p>
          <p className={s.emptySub}>You can also start a chat from an order on the Orders page.</p>
        </div>
      ) : (
        <div className={`${s.layout} ${selected ? s.hasSelection : ""}`}>
          <ul className={s.list} aria-label="Chats">
            {chats.map((chat) => (
              <li key={chat.order_id}>
                <ChatRow chat={chat} active={chat.order_id === selectedId} onOpen={() => open(chat.order_id)} />
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
                    <strong>{selected.buyer_name ?? "Buyer"}</strong>
                    <span>
                      {selected.order_ref} · {ORDER_STATUS_LABELS[selected.order_status] ?? selected.order_status}
                    </span>
                  </div>
                </div>
                <div className={s.threadBody}>
                  <OrderChat
                    key={selected.order_id}
                    orderId={selected.order_id}
                    title="Messages"
                    fill
                  />
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

function ChatRow({ chat, active, onOpen }: { chat: MerchantChatSummary; active: boolean; onOpen: () => void }) {
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
        {chat.order_ref}
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
