"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useVisibleInterval } from "@/hooks/useVisibleInterval";
import { fetchMyChats, fetchMyInquiries, type BuyerChatSummary, type InquirySummary } from "@/util/api/users";

// The sidebar count must not be old for long, but each poll is a database query.
const POLL_MS = 30_000;

type BuyerChatsValue = {
  /** Chats about orders. */
  chats: BuyerChatSummary[];
  /** Questions to farms, no order needed. */
  inquiries: InquirySummary[];
  loaded: boolean;
  error: boolean;
  reload: () => Promise<void>;
  /** Opening a thread marks it read on the server; show that at once. */
  markRead: (orderId: number) => void;
  markInquiryRead: (merchantId: number) => void;
  /** Number of chats with new messages (0 when signed out). */
  unreadCount: number;
};

const BuyerChatsContext = createContext<BuyerChatsValue>({
  chats: [],
  inquiries: [],
  loaded: false,
  error: false,
  reload: async () => {},
  markRead: () => {},
  markInquiryRead: () => {},
  unreadCount: 0,
});

export const useBuyerChats = () => useContext(BuyerChatsContext);

/** The buyer's chats with farms: about orders, and questions before buying. Polls while the tab is visible. */
export function BuyerChatsProvider({ children }: { children: ReactNode }) {
  const { isBackendAuthenticated } = useAuth();
  const [chats, setChats] = useState<BuyerChatSummary[]>([]);
  const [inquiries, setInquiries] = useState<InquirySummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [orderChats, farmQuestions] = await Promise.all([fetchMyChats(), fetchMyInquiries()]);
      setChats(orderChats);
      setInquiries(farmQuestions);
      setLoaded(true);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useVisibleInterval(reload, POLL_MS, isBackendAuthenticated);

  const markRead = useCallback((orderId: number) => {
    setChats((prev) => prev.map((c) => (c.order_id === orderId ? { ...c, unread: 0 } : c)));
  }, []);

  const markInquiryRead = useCallback((merchantId: number) => {
    setInquiries((prev) => prev.map((c) => (c.merchant_id === merchantId ? { ...c, unread: 0 } : c)));
  }, []);

  const unreadCount = isBackendAuthenticated
    ? chats.filter((c) => c.unread > 0).length + inquiries.filter((c) => c.unread > 0).length
    : 0;

  return (
    <BuyerChatsContext.Provider
      value={{ chats, inquiries, loaded, error, reload, markRead, markInquiryRead, unreadCount }}
    >
      {children}
    </BuyerChatsContext.Provider>
  );
}
