"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchMerchantById,
  fetchMerchantShopPage,
  fetchMyMerchantPerformance,
  fetchMyProduce,
  type Merchant,
  type MerchantPerformance,
  type Produce,
  type ShopPage,
} from "@/util/api";
import { useMerchantOrders, type MerchantOrdersState } from "./hooks/useMerchantOrders";
import { useShipmentSelection } from "./hooks/useShipmentSelection";

/**
 * Data that more than one merchant page reads (the sidebar counts, the
 * dashboard, the orders and shipments pages). The shell layout loads it once,
 * so a move between pages does not fetch it again.
 */
export type MerchantStatus = "loading" | "signed-out" | "not-merchant" | "error" | "ready";

type MerchantContextValue = {
  status: MerchantStatus;
  userName: string;
  userEmail: string;
  performance: MerchantPerformance | null;
  reloadPerformance: () => void;
  merchant: Merchant | null;
  setMerchant: (m: Merchant) => void;
  shopPage: ShopPage | null;
  setShopPage: (s: ShopPage) => void;
  produces: Produce[];
  setProduces: React.Dispatch<React.SetStateAction<Produce[]>>;
  produceLoading: boolean;
  ordersState: MerchantOrdersState;
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
  const [shopPage, setShopPage] = useState<ShopPage | null>(null);
  const [produces, setProduces] = useState<Produce[]>([]);
  const [produceLoading, setProduceLoading] = useState(false);

  const ordersState = useMerchantOrders(isMerchant === true);
  const shipmentSelection = useShipmentSelection(ordersState.readyToShip);

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
          fetchMerchantShopPage(merchantId),
          fetchMerchantById(merchantId),
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

  const reloadPerformance = useCallback(() => setAttempt((n) => n + 1), []);

  let status: MerchantStatus;
  if (authLoading) status = "loading";
  else if (!isAuthenticated) status = "signed-out";
  else if (isMerchant === false) status = "not-merchant";
  else if (performance && isMerchant) status = "ready";
  else if (perfFailed) status = "error";
  else status = perfLoading ? "loading" : "error";

  const value = useMemo<MerchantContextValue>(
    () => ({
      status,
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
      ordersState,
      shipmentSelection,
    }),
    [status, user, performance, reloadPerformance, merchant, shopPage, produces, produceLoading, ordersState, shipmentSelection],
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
