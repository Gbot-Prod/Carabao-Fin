"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchMyMerchant,
  fetchMyMerchantApplication,
  fetchMyMerchantPerformance,
  fetchMyProduce,
  fetchMyShopPage,
  type Merchant,
  type MerchantPerformance,
  type MyShopPage,
  type Produce,
} from "@/util/api";
import { useMerchantOrders, type MerchantOrdersState } from "./hooks/useMerchantOrders";
import { useShipmentSelection } from "./hooks/useShipmentSelection";
import { useMerchantChats, type MerchantChatsState } from "./hooks/useMerchantChats";
import type { OrderStatus } from "@/util/api";

// Same statuses as ACTIVE_ORDER_STATUSES in backend/app/services/order_status.py.
const ACTIVE_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["pending", "processing", "shipped", "out_for_delivery"]);

/**
 * Data that more than one merchant page reads (the sidebar counts, the
 * dashboard, the orders and shipments pages). The shell layout loads it once,
 * so a move between pages does not fetch it again.
 */
export type MerchantStatus = "loading" | "signed-out" | "not-merchant" | "error" | "ready";

type MerchantContextValue = {
  status: MerchantStatus;
  /**
   * For status "not-merchant": the application status ("submitted",
   * "clarification", "rejected", "suspended", "approved"), null when there is
   * no application or when it could not load, undefined while it loads.
   */
  applicationStatus: string | null | undefined;
  userName: string;
  userEmail: string;
  performance: MerchantPerformance | null;
  reloadPerformance: () => void;
  merchant: Merchant | null;
  setMerchant: (m: Merchant) => void;
  /** The owner's shop page: the live version plus the unpublished draft. */
  shopPage: MyShopPage | null;
  setShopPage: (s: MyShopPage) => void;
  produces: Produce[];
  setProduces: React.Dispatch<React.SetStateAction<Produce[]>>;
  produceLoading: boolean;
  /**
   * Counts that change while the merchant works (an order delivered, a listing
   * added). From the loaded lists when they are there, else from performance,
   * which loads one time only.
   */
  activeOrderCount: number;
  productCount: number;
  ordersState: MerchantOrdersState;
  chatsState: MerchantChatsState;
  shipmentSelection: ReturnType<typeof useShipmentSelection>;
};

const MerchantContext = createContext<MerchantContextValue | null>(null);

export function MerchantProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [performance, setPerformance] = useState<MerchantPerformance | null>(null);
  // null = not known yet; the API answers 404 when this user has no merchant row.
  const [isMerchant, setIsMerchant] = useState<boolean | null>(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [perfFailed, setPerfFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [shopPage, setShopPage] = useState<MyShopPage | null>(null);
  const [produces, setProduces] = useState<Produce[]>([]);
  // true from the start: pages render only after the merchant loads, and this load starts then.
  const [produceLoading, setProduceLoading] = useState(true);

  const ordersState = useMerchantOrders(isMerchant === true);
  const shipmentSelection = useShipmentSelection(ordersState.readyToShip);
  const chatsState = useMerchantChats(isMerchant === true);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    let cancelled = false;
    const load = async () => {
      setPerfLoading(true);
      setPerfFailed(false);
      try {
        const perf = await fetchMyMerchantPerformance();
        if (cancelled) return;
        setPerformance(perf);
        setIsMerchant(true);
      } catch (e: unknown) {
        if (cancelled) return;
        const err = e as { response?: { status?: number } };
        if (err?.response?.status === 404) setIsMerchant(false);
        else setPerfFailed(true);
      } finally {
        if (!cancelled) setPerfLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, attempt]);

  const merchantId = performance?.merchant_id;
  useEffect(() => {
    if (!merchantId) return;
    const load = async () => {
      setProduceLoading(true);
      try {
        const [produceRes, shopPageRes, merchantRes] = await Promise.allSettled([
          fetchMyProduce(),
          // The owner routes: the public ones hide a shop that is not published,
          // and the public /merchants/{id} leaves out address and pin.
          fetchMyShopPage(),
          fetchMyMerchant(),
        ]);
        if (produceRes.status === "fulfilled") setProduces(produceRes.value);
        if (shopPageRes.status === "fulfilled") setShopPage(shopPageRes.value);
        if (merchantRes.status === "fulfilled") setMerchant(merchantRes.value);
      } finally {
        setProduceLoading(false);
      }
    };
    void load();
  }, [merchantId]);

  const [applicationStatus, setApplicationStatus] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (isMerchant !== false) return;
    let live = true;
    fetchMyMerchantApplication()
      .then((a) => live && setApplicationStatus(a ? a.status : null))
      // Not known: show the welcome page. The backend refuses a second
      // application, so a wrong "Start Registration" does no harm.
      .catch(() => live && setApplicationStatus(null));
    return () => {
      live = false;
    };
  }, [isMerchant]);

  const reloadPerformance = useCallback(() => setAttempt((n) => n + 1), []);

  let status: MerchantStatus;
  if (authLoading) status = "loading";
  else if (!isAuthenticated) status = "signed-out";
  else if (isMerchant === false) status = "not-merchant";
  else if (performance && isMerchant) status = "ready";
  else if (perfFailed) status = "error";
  else status = perfLoading ? "loading" : "error";

  const activeOrderCount = ordersState.loaded
    ? ordersState.orders.filter((o) => ACTIVE_STATUSES.has(o.status)).length
    : performance?.active_orders ?? 0;
  const productCount = produceLoading ? performance?.total_products ?? produces.length : produces.length;

  const value = useMemo<MerchantContextValue>(
    () => ({
      status,
      applicationStatus,
      userName: user?.name ?? "",
      userEmail: user?.email ?? "",
      performance,
      reloadPerformance,
      merchant,
      setMerchant,
      shopPage,
      setShopPage,
      produces,
      setProduces,
      produceLoading,
      activeOrderCount,
      productCount,
      ordersState,
      chatsState,
      shipmentSelection,
    }),
    [status, applicationStatus, user, performance, reloadPerformance, merchant, shopPage, produces, produceLoading, activeOrderCount, productCount, ordersState, chatsState, shipmentSelection],
  );

  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

export function useMerchant(): MerchantContextValue {
  const ctx = useContext(MerchantContext);
  if (!ctx) throw new Error("useMerchant must be used inside MerchantProvider");
  return ctx;
}

/** Pages under the shell render only when status is "ready", so performance is set. */
export function useReadyMerchant() {
  const ctx = useMerchant();
  if (!ctx.performance) throw new Error("useReadyMerchant used before the merchant loaded");
  return { ...ctx, performance: ctx.performance };
}
