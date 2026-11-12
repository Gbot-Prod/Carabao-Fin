"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import {
  fetchMyMerchantPerformance,
  fetchMerchantById,
  fetchMerchantProduce,
  fetchMerchantShopPage,
  type Merchant,
  type MerchantPerformance,
  type Produce,
  type ShopPage,
} from "@/util/api";
import { useMerchantOrders } from "./hooks/useMerchantOrders";
import { useShipmentSelection } from "./hooks/useShipmentSelection";
import DashboardHeader from "./components/DashboardHeader";
import OverviewTab from "./components/OverviewTab";
import ProduceTab from "./components/ProduceTab";
import ShopTab from "./components/ShopTab";
import OrdersTab from "./components/OrdersTab";
import ShipmentsTab from "./components/ShipmentsTab";
import ReviewsTab from "./components/ReviewsTab";
import EarningsTab from "./components/EarningsTab";
import DangerZone from "./components/DangerZone";

type Tab = "overview" | "produce" | "shop" | "orders" | "shipments" | "reviews" | "earnings";
const TABS: Tab[] = ["overview", "produce", "shop", "orders", "shipments", "reviews", "earnings"];

export default function MerchantDashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [isLoading, setIsLoading] = useState(true);
  const [isMerchant, setIsMerchant] = useState<boolean | null>(null);
  const [performance, setPerformance] = useState<MerchantPerformance | null>(null);

  // Shared across tabs (header logo, overview stock, tab counts), so owned here.
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [shopPage, setShopPage] = useState<ShopPage | null>(null);
  const [produces, setProduces] = useState<Produce[]>([]);
  const [produceLoading, setProduceLoading] = useState(false);

  // Loaded up front so the Orders and Shipments tab labels show counts straight away.
  const ordersState = useMerchantOrders(isMerchant === true);
  const shipmentSelection = useShipmentSelection(ordersState.readyToShip);
  const [focusOrderId, setFocusOrderId] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        setPerformance(await fetchMyMerchantPerformance());
        setIsMerchant(true);
      } catch (e: unknown) {
        const err = e as { response?: { status?: number } };
        setIsMerchant(err?.response?.status === 404 ? false : null);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const merchantId = performance?.merchant_id;
  useEffect(() => {
    if (!merchantId) return;
    const load = async () => {
      setProduceLoading(true);
      try {
        const [produceRes, shopPageRes, merchantRes] = await Promise.allSettled([
          fetchMerchantProduce(merchantId),
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

  // A review's "View order" link: open the orders tab and bring that card into view.
  const jumpToOrder = (orderId: number) => {
    setFocusOrderId(orderId);
    setActiveTab("orders");
  };
  const clearFocusOrder = useCallback(() => setFocusOrderId(null), []);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingState}>
          <PageLoader label="Loading dashboard…" />
        </div>
      </div>
    );
  }

  if (isMerchant === false) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyState}>
          <h1 className={styles.emptyTitle}>No merchant profile</h1>
          <p className={styles.emptyDesc}>Apply to become a merchant and start selling your produce.</p>
          <div className={styles.emptyActions}>
            <Link className={styles.primaryBtn} href="/merchantOnboarding">Apply as Merchant</Link>
            <Link className={styles.secondaryBtn} href="/profile">Back to Profile</Link>
          </div>
        </div>
      </div>
    );
  }

  const ratingCount = performance?.rating_count ?? 0;
  const orderCount = ordersState.orders.length;
  const readyCount = ordersState.readyToShip.length;
  const tabLabel: Record<Tab, string> = {
    overview: "Overview",
    produce: `Produce (${produces.length})`,
    shop: "Shop Page",
    orders: `Orders${orderCount ? ` (${orderCount})` : ""}`,
    shipments: `Shipments${readyCount ? ` (${readyCount} ready)` : ""}`,
    reviews: `Reviews${ratingCount ? ` (${ratingCount})` : ""}`,
    earnings: "Earnings",
  };

  return (
    <div className={styles.page}>
      <DashboardHeader performance={performance} logoUrl={shopPage?.logo_url} />

      <nav className={styles.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`${styles.tabBtn} ${activeTab === tab ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tabLabel[tab]}
          </button>
        ))}
      </nav>

      <div className={styles.tabContent}>
        {activeTab === "overview" && performance && (
          <OverviewTab
            performance={performance}
            produces={produces}
            onOpenReviews={() => setActiveTab("reviews")}
            onOpenOrders={() => setActiveTab("orders")}
          />
        )}
        {activeTab === "produce" && (
          <ProduceTab produces={produces} setProduces={setProduces} loading={produceLoading} />
        )}
        {activeTab === "shop" && (
          <ShopTab shopPage={shopPage} onShopPageChange={setShopPage} merchant={merchant} onMerchantChange={setMerchant} />
        )}
        {activeTab === "orders" && (
          <OrdersTab
            ordersState={ordersState}
            focusOrderId={focusOrderId}
            onFocusDone={clearFocusOrder}
            onOpenShipments={() => setActiveTab("shipments")}
          />
        )}
        {activeTab === "shipments" && (
          <ShipmentsTab
            ordersState={ordersState}
            selection={shipmentSelection}
            onOpenOrders={() => setActiveTab("orders")}
          />
        )}
        {activeTab === "reviews" && <ReviewsTab onViewOrder={jumpToOrder} />}
        {activeTab === "earnings" && <EarningsTab />}
      </div>

      <DangerZone />
    </div>
  );
}
