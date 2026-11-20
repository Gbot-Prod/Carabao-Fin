import { useCallback, useEffect, useState } from "react";
import {
  fetchMyMerchantChats,
  fetchMyMerchantInquiries,
  type InquirySummary,
  type MerchantChatSummary,
} from "@/util/api";

// The sidebar count must not be old for long, but each poll is a database query.
const POLL_MS = 30_000;

/**
 * The farm's chats: about orders, and questions buyers sent before buying.
 * Lives in MerchantProvider because the sidebar shows the unread count on
 * every page. Polls while the tab is visible.
 */
export function useMerchantChats(enabled: boolean) {
  const [chats, setChats] = useState<MerchantChatSummary[]>([]);
  const [inquiries, setInquiries] = useState<InquirySummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [orderChats, questions] = await Promise.all([fetchMyMerchantChats(), fetchMyMerchantInquiries()]);
      setChats(orderChats);
      setInquiries(questions);
      setLoaded(true);
      setError(null);
    } catch {
      setError("Failed to load chats. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => void reload(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, reload]);

  /** Opening a thread marks it read on the server; show that at once. */
  const markRead = useCallback((orderId: number) => {
    setChats((prev) => prev.map((c) => (c.order_id === orderId ? { ...c, unread: 0 } : c)));
  }, []);

  const markInquiryRead = useCallback((conversationId: number) => {
    setInquiries((prev) => prev.map((c) => (c.conversation_id === conversationId ? { ...c, unread: 0 } : c)));
  }, []);

  const unreadCount =
    chats.reduce((sum, c) => sum + (c.unread > 0 ? 1 : 0), 0) +
    inquiries.reduce((sum, c) => sum + (c.unread > 0 ? 1 : 0), 0);

  return { chats, inquiries, loaded, error, reload, markRead, markInquiryRead, unreadCount };
}

export type MerchantChatsState = ReturnType<typeof useMerchantChats>;
