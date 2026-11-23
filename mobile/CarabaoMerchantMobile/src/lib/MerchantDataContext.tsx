// src/lib/MerchantDataContext.tsx
// S3 (plan §4): the data more than one screen reads — performance (Home), produce
// (Produce tab, counts), the shop page (S14) and the orders (Orders tab, Shipments row,
// counts) — loaded once and shared, plus `refresh*()` so a screen that changes something
// updates the badges. The web does the same in its MerchantContext.tsx.
//
// Mounted by app/_layout.tsx only once the root gate says `allowed` (CF-0120), so no
// /merchants/me/* call runs before the app knows the account is a farm. New screens read
// it with `useMerchantData()`; they do not fetch this data again.
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { api, ApiError, type ApiMerchantOrder, type ApiProduce, type ApiShopPage } from './api';
import { useAuth } from './AuthContext';
import type { ChatSummary } from './chatInbox';
import type { MerchantPerformance } from './dashboard';
import { usePolling } from './usePolling';

// The chats sidebar polls every 30 s on the web (useMerchantChats POLL_MS); the orders
// poll at the same wait so the Orders and Shipments counts are as fresh as the web's.
const REFRESH_MS = 30_000;

const LOAD_ERROR = 'We couldn’t load your farm’s data. Check your connection and try again.';

export interface MerchantDataValue {
  /** Home's numbers (GET /merchants/me/performance). */
  performance: MerchantPerformance | null;
  /** The farm's listings, expired and hidden ones included. */
  produce: ApiProduce[] | null;
  /** null until the farm creates its shop page (the endpoint is 404 then, S14). */
  shopPage: ApiShopPage | null;
  /** Every order the farm has (GET /merchants/me/orders). */
  orders: ApiMerchantOrder[] | null;
  /** The order chats; the Chats tab and the unread badge (S5 adds inquiries). */
  chats: ChatSummary[] | null;
  /** True while the first load runs. */
  loading: boolean;
  /** Why the last load or refresh failed; null once one succeeds. */
  error: string | null;

  refreshPerformance: () => Promise<void>;
  refreshProduce: () => Promise<void>;
  refreshShopPage: () => Promise<void>;
  refreshOrders: () => Promise<void>;
  refreshChats: () => Promise<void>;
}

const MerchantDataContext = createContext<MerchantDataValue | null>(null);

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : LOAD_ERROR;
}

export function MerchantDataProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const signedIn = !!token;

  const [performance, setPerformance] = useState<MerchantPerformance | null>(null);
  const [produce, setProduce] = useState<ApiProduce[] | null>(null);
  const [shopPage, setShopPage] = useState<ApiShopPage | null>(null);
  const [orders, setOrders] = useState<ApiMerchantOrder[] | null>(null);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The access token is refreshed about every minute; a ref keeps the newest one
  // without running the first load again (same idea as the gate in MerchantContext.tsx).
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const firstLoadDone = useRef(false);

  const loadPerformance = useCallback(async () => {
    setPerformance(await api.merchants.performance(tokenRef.current));
  }, []);

  const loadProduce = useCallback(async () => {
    setProduce(await api.merchants.myProduce(tokenRef.current));
  }, []);

  const loadOrders = useCallback(async () => {
    setOrders(await api.merchants.myOrders(tokenRef.current));
  }, []);

  // 404 means the farm has not created its shop page yet, which is a normal state
  // (backend merchant_shop.py), not a load failure.
  const loadShopPage = useCallback(async () => {
    try {
      setShopPage(await api.merchants.shopPage(tokenRef.current));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setShopPage(null);
        return;
      }
      throw err;
    }
  }, []);

  // One failing call (say the shop page) must not hide what the others loaded.
  const loadAll = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      loadPerformance(), loadProduce(), loadShopPage(), loadOrders(),
    ]);
    firstLoadDone.current = true;
    setLoading(false);
    const failed = results.find((r) => r.status === 'rejected');
    setError(failed && failed.status === 'rejected' ? messageOf(failed.reason) : null);
  }, [loadPerformance, loadProduce, loadShopPage, loadOrders]);

  // The provider stays mounted (it wraps the navigator), so it loads once per account:
  // signing out unmounts it, and the next account starts with empty state. The timeout
  // defers the first setState out of the effect body (react-hooks/set-state-in-effect),
  // the same way the web's hooks start their first poll.
  useEffect(() => {
    if (!signedIn) return;
    const first = setTimeout(() => { void loadAll(); }, 0);
    return () => clearTimeout(first);
  }, [signedIn, loadAll]);

  const run = useCallback(async (load: () => Promise<void>) => {
    try {
      await load();
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  const refreshPerformance = useCallback(() => run(loadPerformance), [run, loadPerformance]);
  const refreshProduce = useCallback(() => run(loadProduce), [run, loadProduce]);
  const refreshShopPage = useCallback(() => run(loadShopPage), [run, loadShopPage]);
  const refreshOrders = useCallback(() => run(loadOrders), [run, loadOrders]);

  // The chat badge keeps its last count when a poll fails; the Chats screen shows its
  // own load error (S5), so an outage is never drawn as "no chats".
  const refreshChats = useCallback(async () => {
    try {
      setChats(await api.merchants.chats(tokenRef.current));
    } catch {
      // Keep the last count.
    }
  }, []);

  // The first tick runs at mount, while loadAll is already fetching the orders.
  const pollOrders = useCallback(() => {
    if (!firstLoadDone.current) return undefined;
    return refreshOrders();
  }, [refreshOrders]);

  usePolling(pollOrders, REFRESH_MS, signedIn);
  usePolling(refreshChats, REFRESH_MS, signedIn);

  const value = useMemo<MerchantDataValue>(
    () => ({
      performance, produce, shopPage, orders, chats, loading, error,
      refreshPerformance, refreshProduce, refreshShopPage, refreshOrders, refreshChats,
    }),
    [
      performance, produce, shopPage, orders, chats, loading, error,
      refreshPerformance, refreshProduce, refreshShopPage, refreshOrders, refreshChats,
    ],
  );

  return <MerchantDataContext.Provider value={value}>{children}</MerchantDataContext.Provider>;
}

/** Throws outside the provider: a screen mounted before the gate would read no farm. */
export function useMerchantData(): MerchantDataValue {
  const value = useContext(MerchantDataContext);
  if (!value) throw new Error('useMerchantData must be used inside MerchantDataProvider');
  return value;
}

