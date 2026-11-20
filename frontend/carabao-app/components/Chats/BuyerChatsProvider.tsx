"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useVisibleInterval } from "@/hooks/useVisibleInterval";
import { fetchMyChats, type BuyerChatSummary } from "@/util/api/users";

// The sidebar count must not be old for long, but each poll is a database query.
const POLL_MS = 30_000;

type BuyerChatsValue = {
  chats: BuyerChatSummary[];
  loaded: boolean;
  error: boolean;
  reload: () => Promise<void>;
  /** Opening a thread marks it read on the server; show that at once. */
  markRead: (orderId: number) => void;
  /** Number of chats with new messages (0 when signed out). */
  unreadCount: number;
};

const BuyerChatsContext = createContext<BuyerChatsValue>({
  chats: [],
  loaded: false,
  error: false,
  reload: async () => {},
  markRead: () => {},
  unreadCount: 0,
});

export const useBuyerChats = () => useContext(BuyerChatsContext);

/** The buyer's order chats with farms. Polls while the tab is visible. */
export function BuyerChatsProvider({ children }: { children: ReactNode }) {
  const { isBackendAuthenticated } = useAuth();
  const [chats, setChats] = useState<BuyerChatSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      setChats(await fetchMyChats());
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

  const unreadCount = isBackendAuthenticated ? chats.filter((c) => c.unread > 0).length : 0;

  return (
    <BuyerChatsContext.Provider value={{ chats, loaded, error, reload, markRead, unreadCount }}>
      {children}
    </BuyerChatsContext.Provider>
  );
}
