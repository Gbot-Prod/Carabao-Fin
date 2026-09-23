"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { useRouter } from "next/navigation";
import LocationSelects from "@/components/LocationSelects/LocationSelects";
import {
  fetchMyMerchantPerformance,
  fetchMerchantById,
  fetchMerchantProduce,
  fetchMerchantShopPage,
  updateMyMerchant,
  fetchMyPayoutInfo,
  fetchMyPayouts,
  fetchMyTransactions,
  fetchMyMerchantOrders,
  updateMerchantOrderStatus,
  createMerchantShipment,
  fetchMyShipments,
  updateMyPayoutInfo,
  requestPayout,
  createMyShopPage,
  updateMyShopPage,
  uploadBannerImage,
  uploadShopLogo,
  createProduce,
  updateProduce,
  deleteProduce,
  uploadProduceImage,
  deleteMyMerchant,
  type Merchant,
  type MerchantPerformance,
  type Produce,
  type ShopPage,
  type ProduceCreatePayload,
  type PayoutInfo,
  type MerchantPayoutBatch,
  type MerchantTransaction,
  type MerchantOrder,
} from "@/util/api";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function formatLocalPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 10);
  return [a, b, c].filter(Boolean).join(" ");
}

const formatPeso = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

const formatDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
};

type Tab = "overview" | "produce" | "shop" | "earnings" | "orders";

type ProduceFormState = {
  name: string;
  description: string;
  category: "Vegetables" | "Fruits" | "";
  price: number;
  unit: "kg" | "lbs";
  unit_quantity: number;
  stock_quantity: number;
  image_url: string;
};

const emptyForm: ProduceFormState = { name: "", description: "", category: "", price: 0, unit: "kg", unit_quantity: 1, stock_quantity: 0, image_url: "" };

function TickGroup<T extends string>({
  label, options, value, onChange,
}: { label: string; options: T[]; value: T | ""; onChange: (v: T) => void }) {
  return (
    <div>
      <div className={styles.formTickLabel}>{label}</div>
      <div className={styles.tickRow}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`${styles.tickBtn} ${value === opt ? styles.tickBtnActive : ""}`}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProduceFormFields({ form, onChange }: { form: ProduceFormState; onChange: (f: ProduceFormState) => void }) {
  return (
    <>
      <div className={styles.formGrid}>
        <label className={styles.formLabel}>
          Name *
          <input className={styles.formInput} required value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} />
        </label>
        <label className={styles.formLabel}>
          Stock
          <input className={styles.formInput} type="number" min="0" value={form.stock_quantity} onChange={(e) => onChange({ ...form, stock_quantity: Number(e.target.value) })} />
        </label>
      </div>

      <div className={styles.formTickRow}>
        <TickGroup
          label="Category"
          options={["Vegetables", "Fruits"] as const}
          value={form.category}
          onChange={(v) => onChange({ ...form, category: v })}
        />
        <TickGroup
          label="Unit"
          options={["kg", "lbs"] as const}
          value={form.unit}
          onChange={(v) => onChange({ ...form, unit: v })}
        />
      </div>

      <div className={styles.priceRow}>
        <label className={styles.formLabel} style={{ flex: 1 }}>
          Price (₱)
          <input className={styles.formInput} type="number" min="0" value={form.price} onChange={(e) => onChange({ ...form, price: Number(e.target.value) })} />
        </label>
        <div className={styles.pricePerLabel}>per</div>
        <label className={styles.formLabel} style={{ width: 90 }}>
          Quantity
          <input className={styles.formInput} type="number" min="0.1" step="0.1" value={form.unit_quantity ?? 1} onChange={(e) => onChange({ ...form, unit_quantity: Number(e.target.value) || 1 })} />
        </label>
        <div className={styles.priceUnitLabel}>{form.unit}</div>
      </div>

      {form.price > 0 && form.unit_quantity > 0 && (
        <div className={styles.pricePreview}>
          ₱{form.price} per {form.unit_quantity === 1 ? "" : form.unit_quantity}{form.unit}
        </div>
      )}

      <label className={styles.formLabelFull}>
        Description
        <textarea className={styles.formInput} rows={2} value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} />
      </label>
    </>
  );
}

export default function MerchantDashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [isLoading, setIsLoading] = useState(true);
  const [isMerchant, setIsMerchant] = useState<boolean | null>(null);
  const [performance, setPerformance] = useState<MerchantPerformance | null>(null);

  const [shopPage, setShopPage] = useState<ShopPage | null>(null);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [shopPageEditing, setShopPageEditing] = useState(false);
  const [shopPageDraft, setShopPageDraft] = useState({ title: "", description: "" });
  const [shopPageSaving, setShopPageSaving] = useState(false);
  const [shopPageCreating, setShopPageCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState({ title: "", description: "" });

  const [produces, setProduces] = useState<Produce[]>([]);
  const [produceLoading, setProduceLoading] = useState(false);
  const [uploadingProduceIds, setUploadingProduceIds] = useState<Set<number>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<ProduceFormState>(emptyForm);
  const [editingProduceId, setEditingProduceId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ProduceFormState>(emptyForm);
  const [produceFormLoading, setProduceFormLoading] = useState(false);

  const [payoutInfo, setPayoutInfo] = useState<PayoutInfo | null>(null);
  const [payouts, setPayouts] = useState<MerchantPayoutBatch[]>([]);
  const [transactions, setTransactions] = useState<MerchantTransaction[]>([]);
  const [payoutInfoDraft, setPayoutInfoDraft] = useState({ payout_type: "gcash", bank_code: "", account_number: "", account_name: "", ewallet_number: "" });
  const [payoutInfoEditing, setPayoutInfoEditing] = useState(false);
  const [payoutInfoSaving, setPayoutInfoSaving] = useState(false);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [payoutMessage, setPayoutMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [earningsLoaded, setEarningsLoaded] = useState(false);

  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);
  const [orderFilter, setOrderFilter] = useState<string>("all");
  const [selectedShipmentOrderIds, setSelectedShipmentOrderIds] = useState<Set<number>>(new Set());
  const [shipmentCreating, setShipmentCreating] = useState(false);
  const [shipmentMessage, setShipmentMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [shipments, setShipments] = useState<import('@/util/api/merchants').MerchantShipmentSummary[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipmentsError, setShipmentsError] = useState<string | null>(null);

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [locationEditing, setLocationEditing] = useState(false);
  const [locationDraft, setLocationDraft] = useState({ address_line: "", barangay: "", city: "", contact_number: "", available_days: [] as string[] });
  const [locationSaving, setLocationSaving] = useState(false);

  const [deletingMerchant, setDeletingMerchant] = useState(false);
  const [confirmDeleteMerchant, setConfirmDeleteMerchant] = useState(false);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await fetchMyMerchantPerformance();
        setPerformance(data);
        setIsMerchant(true);
      } catch (e: unknown) {
        const err = e as { response?: { status?: number } };
        if (err?.response?.status === 404) setIsMerchant(false);
        else setIsMerchant(null);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!performance?.merchant_id) return;
    const loadSidePanels = async () => {
      setProduceLoading(true);
      try {
        const [produceData, shopPageData, merchantData] = await Promise.allSettled([
          fetchMerchantProduce(performance.merchant_id),
          fetchMerchantShopPage(performance.merchant_id),
          fetchMerchantById(performance.merchant_id),
        ]);
        if (produceData.status === "fulfilled") setProduces(produceData.value);
        if (shopPageData.status === "fulfilled") setShopPage(shopPageData.value);
        if (merchantData.status === "fulfilled") setMerchant(merchantData.value);
      } finally {
        setProduceLoading(false);
      }
    };
    void loadSidePanels();
  }, [performance?.merchant_id]);

  // Lazy-load earnings data when tab is opened
  useEffect(() => {
    if (activeTab !== "earnings" || earningsLoaded) return;
    const loadEarnings = async () => {
      const [piRes, pbRes, txRes] = await Promise.allSettled([
        fetchMyPayoutInfo(),
        fetchMyPayouts(),
        fetchMyTransactions(),
      ]);
      if (piRes.status === "fulfilled") setPayoutInfo(piRes.value);
      if (pbRes.status === "fulfilled") setPayouts(pbRes.value);
      if (txRes.status === "fulfilled") setTransactions(txRes.value);
      setEarningsLoaded(true);
    };
    void loadEarnings();
  }, [activeTab, earningsLoaded]);

  const reloadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const data = await fetchMyMerchantOrders();
      setOrders(data);
      setOrdersLoaded(true);
    } catch {
      setOrdersError("Failed to load orders. Please refresh the tab.");
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "orders" || ordersLoaded) return;
    void reloadOrders();
  }, [activeTab, ordersLoaded, reloadOrders]);

  const merchantName = performance?.merchant_name ?? "Your Shop";

  const stockAnalytics = useMemo(() => {
    const total = produces.reduce((acc, p) => acc + p.price * p.stock_quantity, 0);
    const outOfStock = produces.filter((p) => p.stock_quantity === 0).length;
    const lowStock = produces.filter((p) => p.stock_quantity > 0 && p.stock_quantity < 5).length;
    return { total, outOfStock, lowStock };
  }, [produces]);

  const earningsAnalytics = useMemo(() => {
    const totalPaid = transactions.filter((t) => t.status === "paid").reduce((acc, t) => acc + t.merchant_amount, 0);
    const totalReleased = payouts.filter((p) => p.status === "released").reduce((acc, p) => acc + p.gross_amount, 0);
    const available = Math.max(0, totalPaid - totalReleased);
    const pending = payouts.find((p) => ["pending", "approved", "processing"].includes(p.status));
    return { totalPaid, totalReleased, available, pendingBatch: pending ?? null };
  }, [transactions, payouts]);

  const shipmentCandidates = useMemo(
    () => orders.filter((o) => ["pending", "processing"].includes(o.status) && !o.shipped),
    [orders],
  );

  const selectedShipmentOrders = useMemo(
    () => shipmentCandidates.filter((order) => selectedShipmentOrderIds.has(order.id)),
    [shipmentCandidates, selectedShipmentOrderIds],
  );

  const ratingLabel = useMemo(() => {
    const r = performance?.rating;
    return r == null ? "—" : `${Number(r).toFixed(1)} / 5`;
  }, [performance?.rating]);

  const reloadShipments = useCallback(async () => {
    setShipmentsLoading(true);
    setShipmentsError(null);
    try {
      const data = await fetchMyShipments();
      setShipments(data);
    } catch {
      setShipmentsError('Failed to load shipments.');
    } finally {
      setShipmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "orders" || shipments.length > 0) return;
    void reloadShipments();
  }, [activeTab, shipments.length, reloadShipments]);

  const viewShipment = (id: number) => {
    router.push(`/track?shipment_id=${id}`);
  };

  // ── Produce handlers ────────────────────────────────────────────────────────

  const startEdit = (p: Produce) => {
    setEditingProduceId(p.id);
    setEditForm({ name: p.name ?? "", description: p.description ?? "", category: p.category ?? "", price: p.price, unit: p.unit ?? "kg", unit_quantity: p.unit_quantity ?? 1, stock_quantity: p.stock_quantity, image_url: p.image_url ?? "" });
  };

  const handleProduceImageUpload = async (produceId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingProduceIds((prev) => new Set(prev).add(produceId));
    try {
      const updated = await uploadProduceImage(produceId, file);
      setProduces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      if (editingProduceId === produceId) setEditForm((prev) => ({ ...prev, image_url: updated.image_url ?? "" }));
    } catch { /* silently fail */ }
    finally {
      setUploadingProduceIds((prev) => { const n = new Set(prev); n.delete(produceId); return n; });
      e.target.value = "";
    }
  };

  const handleAddProduce = async (e: React.FormEvent) => {
    e.preventDefault();
    setProduceFormLoading(true);
    try {
      const payload: ProduceCreatePayload = { name: addForm.name, description: addForm.description || null, category: addForm.category || null, price: addForm.price, unit: addForm.unit, unit_quantity: addForm.unit_quantity, stock_quantity: addForm.stock_quantity, image_url: addForm.image_url || null };
      const created = await createProduce(payload);
      setProduces((prev) => [...prev, created]);
      setShowAddForm(false);
      setAddForm(emptyForm);
    } catch { /* silently fail */ }
    finally { setProduceFormLoading(false); }
  };

  const handleUpdateProduce = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingProduceId === null) return;
    setProduceFormLoading(true);
    try {
      const updated = await updateProduce(editingProduceId, { name: editForm.name, description: editForm.description || null, category: editForm.category || null, price: editForm.price, unit: editForm.unit, unit_quantity: editForm.unit_quantity, stock_quantity: editForm.stock_quantity, image_url: editForm.image_url || null });
      setProduces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setEditingProduceId(null);
    } catch { /* silently fail */ }
    finally { setProduceFormLoading(false); }
  };

  const handleDeleteProduce = async (id: number) => {
    if (!window.confirm("Delete this produce item?")) return;
    try { await deleteProduce(id); setProduces((prev) => prev.filter((p) => p.id !== id)); }
    catch { /* silently fail */ }
  };

  // ── Location / merchant profile handlers ─────────────────────────────────────

  const handleSaveLocation = async () => {
    setLocationSaving(true);
    try {
      const location = [locationDraft.address_line, locationDraft.barangay, locationDraft.city]
        .map((s) => s.trim()).filter(Boolean).join(", ") || null;
      const localDigits = locationDraft.contact_number.replace(/\s/g, "");
      const contact_number = localDigits ? `+63 ${formatLocalPhone(localDigits)}` : undefined;
      const operating_hours = locationDraft.available_days.length > 0
        ? locationDraft.available_days.join(", ") : null;
      const updated = await updateMyMerchant({ location, contact_number, operating_hours });
      setMerchant(updated);
      setLocationEditing(false);
    } catch { /* silently fail */ }
    finally { setLocationSaving(false); }
  };

  // ── Shop page handlers ───────────────────────────────────────────────────────

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBannerUploading(true);
    try { const updated = await uploadBannerImage(file); setShopPage(updated); }
    catch { /* silently fail */ }
    finally { setBannerUploading(false); e.target.value = ""; }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try { const updated = await uploadShopLogo(file); setShopPage(updated); }
    catch { /* silently fail */ }
    finally { setLogoUploading(false); e.target.value = ""; }
  };

  const handleSaveShopPage = async () => {
    setShopPageSaving(true);
    try {
      const updated = await updateMyShopPage({ title: shopPageDraft.title.trim() || undefined, description: shopPageDraft.description.trim() || null });
      setShopPage(updated);
      setShopPageEditing(false);
    } catch { /* silently fail */ }
    finally { setShopPageSaving(false); }
  };

  const handleCreateShopPage = async () => {
    if (!createDraft.title.trim()) return;
    setShopPageCreating(true);
    const slug = createDraft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    try {
      const created = await createMyShopPage({ title: createDraft.title.trim(), slug, description: createDraft.description.trim() || null });
      setShopPage(created);
      setCreateDraft({ title: "", description: "" });
    } catch { /* silently fail */ }
    finally { setShopPageCreating(false); }
  };

  // ── Payout handlers ──────────────────────────────────────────────────────────

  const handleSavePayoutInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayoutInfoSaving(true);
    try {
      const updated = await updateMyPayoutInfo({
        payout_type: payoutInfoDraft.payout_type,
        bank_code: payoutInfoDraft.bank_code || null,
        account_number: payoutInfoDraft.account_number || null,
        account_name: payoutInfoDraft.account_name || null,
        ewallet_number: payoutInfoDraft.ewallet_number || null,
      });
      setPayoutInfo(updated);
      setPayoutInfoEditing(false);
    } catch { /* silently fail */ }
    finally { setPayoutInfoSaving(false); }
  };

  const handleRequestPayout = async () => {
    setRequestingPayout(true);
    setPayoutMessage(null);
    try {
      const batch = await requestPayout();
      setPayouts((prev) => [batch, ...prev]);
      setPayoutMessage({ type: "success", text: `Cash out request submitted for ${formatPeso(batch.gross_amount)}. Admin will process it shortly.` });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setPayoutMessage({ type: "error", text: err?.response?.data?.detail ?? "Could not submit cash out request." });
    } finally {
      setRequestingPayout(false);
    }
  };

  const toggleShipmentOrder = (orderId: number) => {
    setShipmentMessage(null);
    setSelectedShipmentOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const handleCreateShipment = async () => {
    const orderIds = Array.from(selectedShipmentOrderIds);
    if (orderIds.length === 0) return;

    setShipmentCreating(true);
    setShipmentMessage(null);
    try {
      await createMerchantShipment(orderIds);
      setShipmentMessage({
        type: "success",
        text: `Created a shipment for ${orderIds.length} order${orderIds.length === 1 ? "" : "s"}.`,
      });
      setSelectedShipmentOrderIds(new Set());
      await reloadOrders();
      await reloadShipments();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setShipmentMessage({
        type: "error",
        text: err?.response?.data?.detail ?? "Could not create shipment.",
      });
    } finally {
      setShipmentCreating(false);
    }
  };

  const handleUpdateOrderStatus = async (orderId: number, status: string) => {
    setUpdatingOrderId(orderId);
    try {
      const updated = await updateMerchantOrderStatus(orderId, status);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    } catch { /* silently fail */ }
    finally { setUpdatingOrderId(null); }
  };

  const handleDeleteMerchant = async () => {
    setDeletingMerchant(true);
    try { await deleteMyMerchant(); router.push("/profile"); }
    catch { setDeletingMerchant(false); setConfirmDeleteMerchant(false); }
  };

  // ── Loading / no merchant ───────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingState}>
          <p className={styles.loadingText}>Loading dashboard…</p>
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

  // ── Main dashboard ──────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      {/* Top header */}
      <header className={styles.dashHeader}>
        <div className={styles.dashHeaderLeft}>
          {shopPage?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shopPage.logo_url} alt="" className={styles.dashLogo} />
          )}
          <div>
            <h1 className={styles.dashName}>{merchantName}</h1>
            <p className={styles.dashSub}>Merchant Dashboard</p>
          </div>
        </div>
        <div className={styles.dashHeaderRight}>
          {performance && (
            <div className={styles.quickStats}>
              <div className={styles.quickStat}>
                <span className={styles.quickStatLabel}>Revenue</span>
                <span className={styles.quickStatValue}>{formatPeso(performance.total_revenue)}</span>
              </div>
              <div className={styles.quickStat}>
                <span className={styles.quickStatLabel}>Orders</span>
                <span className={styles.quickStatValue}>{performance.total_orders}</span>
              </div>
              <div className={styles.quickStat}>
                <span className={styles.quickStatLabel}>Active</span>
                <span className={styles.quickStatValue}>{performance.active_orders}</span>
              </div>
            </div>
          )}
          {performance && (
            <Link className={styles.viewShopBtn} href={`/merchant/${performance.merchant_id}`} target="_blank">
              View Shop ↗
            </Link>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <nav className={styles.tabBar}>
        {(["overview", "produce", "shop", "orders", "earnings"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`${styles.tabBtn} ${activeTab === tab ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "overview" && "Overview"}
            {tab === "produce" && `Produce (${produces.length})`}
            {tab === "shop" && "Shop Page"}
            {tab === "orders" && `Orders${orders.length ? ` (${orders.length})` : ""}`}
            {tab === "earnings" && "Earnings"}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className={styles.tabContent}>

        {/* ── OVERVIEW ────────────────────────────────────────────────────── */}
        {activeTab === "overview" && performance && (
          <div className={styles.overviewLayout}>
            {/* KPI grid */}
            <section className={styles.kpiGrid}>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total Revenue</span>
                <strong className={styles.kpiValue}>{formatPeso(performance.total_revenue)}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total Orders</span>
                <strong className={styles.kpiValue}>{performance.total_orders}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Active Orders</span>
                <strong className={styles.kpiValue}>{performance.active_orders}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Products Listed</span>
                <strong className={styles.kpiValue}>{performance.total_products}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Rating</span>
                <strong className={styles.kpiValue}>{ratingLabel}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Last Order</span>
                <strong className={styles.kpiValue}>{formatDate(performance.last_order_at)}</strong>
              </div>
            </section>

            <div className={styles.overviewRow}>
              {/* Last 30 days */}
              <div className={styles.panel}>
                <h2 className={styles.panelTitle}>Last 30 Days</h2>
                <div className={styles.panelStatRow}>
                  <div className={styles.panelStat}>
                    <span className={styles.panelLabel}>Orders</span>
                    <strong className={styles.panelValue}>{performance.last_30_days_orders}</strong>
                  </div>
                  <div className={styles.panelStat}>
                    <span className={styles.panelLabel}>Revenue</span>
                    <strong className={styles.panelValue}>{formatPeso(performance.last_30_days_revenue)}</strong>
                  </div>
                </div>
              </div>

              {/* Order status */}
              <div className={styles.panel}>
                <h2 className={styles.panelTitle}>Order Status</h2>
                <div className={styles.panelStatRow}>
                  <div className={styles.panelStat}>
                    <span className={styles.panelLabel}>Delivered</span>
                    <strong className={styles.panelValue}>{performance.delivered_orders}</strong>
                  </div>
                  <div className={styles.panelStat}>
                    <span className={styles.panelLabel}>Cancelled</span>
                    <strong className={styles.panelValue}>{performance.cancelled_orders}</strong>
                  </div>
                </div>
              </div>

              {/* Stock summary */}
              <div className={styles.panel}>
                <h2 className={styles.panelTitle}>Inventory</h2>
                <div className={styles.panelStatRow}>
                  <div className={styles.panelStat}>
                    <span className={styles.panelLabel}>Inventory Value</span>
                    <strong className={styles.panelValue}>{formatPeso(stockAnalytics.total)}</strong>
                  </div>
                  <div className={styles.panelStat}>
                    <span className={styles.panelLabel}>Out of Stock</span>
                    <strong className={`${styles.panelValue} ${stockAnalytics.outOfStock > 0 ? styles.danger : ""}`}>{stockAnalytics.outOfStock}</strong>
                  </div>
                  <div className={styles.panelStat}>
                    <span className={styles.panelLabel}>Low Stock</span>
                    <strong className={`${styles.panelValue} ${stockAnalytics.lowStock > 0 ? styles.warning : ""}`}>{stockAnalytics.lowStock}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Stock table */}
            {produces.length > 0 && (
              <div className={styles.panel}>
                <h2 className={styles.panelTitle}>Stock by Produce</h2>
                <table className={styles.stockTable}>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Stock</th>
                      <th>Value</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produces.map((p) => {
                      const value = p.price * p.stock_quantity;
                      const status = p.stock_quantity === 0 ? "out" : p.stock_quantity < 5 ? "low" : "ok";
                      return (
                        <tr key={p.id}>
                          <td className={styles.stockName}>{p.name}</td>
                          <td className={styles.stockCategory}>{p.category ?? "—"}</td>
                          <td>₱{p.price} / {p.unit}</td>
                          <td>{p.stock_quantity}</td>
                          <td>{formatPeso(value)}</td>
                          <td>
                            <span className={`${styles.stockBadge} ${styles[`stockBadge_${status}`]}`}>
                              {status === "out" ? "Out of Stock" : status === "low" ? "Low Stock" : "In Stock"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className={styles.overviewActions}>
              <button className={styles.secondaryBtn} onClick={() => setActiveTab("orders")}>View All Orders</button>
            </div>
          </div>
        )}

        {/* ── PRODUCE ─────────────────────────────────────────────────────── */}
        {activeTab === "produce" && (
          <div className={styles.produceLayout}>
            <div className={styles.produceSectionHeader}>
              <h2 className={styles.sectionTitle}>Your Produce</h2>
              {!showAddForm && (
                <button className={styles.primaryBtn} onClick={() => { setShowAddForm(true); setEditingProduceId(null); }}>
                  + Add Produce
                </button>
              )}
            </div>

            {showAddForm && (
              <form onSubmit={(e) => void handleAddProduce(e)} className={styles.produceForm}>
                <p className={styles.formTitle}>New produce</p>
                <ProduceFormFields form={addForm} onChange={setAddForm} />
                <div className={styles.formActions}>
                  <button type="submit" className={styles.primaryBtn} disabled={produceFormLoading}>{produceFormLoading ? "Saving…" : "Save"}</button>
                  <button type="button" className={styles.secondaryBtn} onClick={() => { setShowAddForm(false); setAddForm(emptyForm); }}>Cancel</button>
                </div>
              </form>
            )}

            {produceLoading && <p className={styles.emptyText}>Loading produce…</p>}
            {!produceLoading && produces.length === 0 && !showAddForm && (
              <p className={styles.emptyText}>No produce listed yet. Add your first item above.</p>
            )}

            <div className={styles.produceList}>
              {produces.map((produce) =>
                editingProduceId === produce.id ? (
                  <form key={produce.id} onSubmit={(e) => void handleUpdateProduce(e)} className={styles.produceForm}>
                    <p className={styles.formTitle}>Edit: {produce.name}</p>
                    <ProduceFormFields form={editForm} onChange={setEditForm} />
                    <div className={styles.formActions}>
                      <button type="submit" className={styles.primaryBtn} disabled={produceFormLoading}>{produceFormLoading ? "Saving…" : "Save changes"}</button>
                      <button type="button" className={styles.secondaryBtn} onClick={() => setEditingProduceId(null)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div key={produce.id} className={styles.produceRow}>
                    <label className={styles.produceThumbWrap} title="Click to upload image">
                      {uploadingProduceIds.has(produce.id) ? (
                        <div className={styles.produceThumbPlaceholder}>…</div>
                      ) : produce.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={produce.image_url} alt={produce.name ?? ""} className={styles.produceThumb} />
                      ) : (
                        <div className={styles.produceThumbPlaceholder}>+</div>
                      )}
                      <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} disabled={uploadingProduceIds.has(produce.id)} onChange={(e) => void handleProduceImageUpload(produce.id, e)} />
                    </label>
                    <div className={styles.produceRowInfo}>
                      <strong className={styles.produceName}>{produce.name}</strong>
                      {produce.category && <span className={styles.produceCategory}>{produce.category}</span>}
                      <span className={styles.producePrice}>₱{produce.price} / {produce.unit_quantity !== 1 ? produce.unit_quantity : ""}{produce.unit}</span>
                      <span className={styles.produceStock}>Stock: {produce.stock_quantity}</span>
                      {produce.description && <p className={styles.produceDesc}>{produce.description}</p>}
                    </div>
                    <div className={styles.produceRowActions}>
                      <button className={styles.secondaryBtn} onClick={() => startEdit(produce)}>Edit</button>
                      <button className={styles.dangerBtn} onClick={() => void handleDeleteProduce(produce.id)}>Delete</button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* ── SHOP PAGE ────────────────────────────────────────────────────── */}
        {activeTab === "shop" && (
          <div className={styles.shopLayout}>
            <h2 className={styles.sectionTitle}>Shop Page</h2>

            {!shopPage ? (
              <div className={styles.shopCreateForm}>
                <p className={styles.emptyText} style={{ marginBottom: 12 }}>Set up your public shop page so customers can find you.</p>
                <label className={styles.formLabel}>Title *<input className={styles.formInput} value={createDraft.title} onChange={(e) => setCreateDraft((d) => ({ ...d, title: e.target.value }))} placeholder="e.g. Dela Cruz Farm" /></label>
                <label className={styles.formLabel} style={{ marginTop: 8 }}>Description<textarea className={styles.formInput} rows={2} value={createDraft.description} onChange={(e) => setCreateDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Short description shown on your shop page" /></label>
                <div className={styles.formActions} style={{ marginTop: 10 }}>
                  <button className={styles.primaryBtn} disabled={shopPageCreating || !createDraft.title.trim()} onClick={() => void handleCreateShopPage()}>{shopPageCreating ? "Creating…" : "Create Shop Page"}</button>
                </div>
              </div>
            ) : (
              <div className={styles.shopEditor}>
                <label className={styles.shopBannerWrap} title="Click to change banner">
                  {bannerUploading ? (
                    <div className={styles.shopBannerEmpty}>Uploading…</div>
                  ) : shopPage.banner_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={shopPage.banner_image_url} alt="Shop banner" className={styles.shopBannerImg} />
                  ) : (
                    <div className={styles.shopBannerEmpty}>Click to upload a banner image</div>
                  )}
                  <div className={styles.shopBannerOverlay}>Change Banner</div>
                  <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} disabled={bannerUploading} onChange={(e) => void handleBannerUpload(e)} />
                </label>

                <div className={styles.shopMetaRow}>
                  <label className={styles.shopLogoWrap} title="Click to change logo">
                    {logoUploading ? <div className={styles.shopLogoPlaceholder}>…</div>
                      : shopPage.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={shopPage.logo_url} alt="Shop logo" className={styles.shopLogoImg} />
                      ) : (
                        <div className={styles.shopLogoPlaceholder}>Logo</div>
                      )}
                    <div className={styles.shopLogoOverlay}>Change</div>
                    <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} disabled={logoUploading} onChange={(e) => void handleLogoUpload(e)} />
                  </label>

                  {shopPageEditing ? (
                    <div className={styles.shopInfoForm}>
                      <label className={styles.formLabel}>Title<input className={styles.formInput} value={shopPageDraft.title} onChange={(e) => setShopPageDraft((d) => ({ ...d, title: e.target.value }))} /></label>
                      <label className={styles.formLabel} style={{ marginTop: 8 }}>Description<textarea className={styles.formInput} rows={2} value={shopPageDraft.description} onChange={(e) => setShopPageDraft((d) => ({ ...d, description: e.target.value }))} /></label>
                      <div className={styles.formActions} style={{ marginTop: 8 }}>
                        <button className={styles.primaryBtn} disabled={shopPageSaving} onClick={() => void handleSaveShopPage()}>{shopPageSaving ? "Saving…" : "Save"}</button>
                        <button className={styles.secondaryBtn} onClick={() => setShopPageEditing(false)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.shopInfoView}>
                      <strong className={styles.shopInfoTitle}>{shopPage.title}</strong>
                      {shopPage.description && <p className={styles.shopInfoDesc}>{shopPage.description}</p>}
                      <button className={styles.uploadBtn} style={{ marginTop: 8 }} onClick={() => { setShopPageDraft({ title: shopPage.title, description: shopPage.description ?? "" }); setShopPageEditing(true); }}>Edit title & description</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Store details (location / contact / hours) ── */}
            <div className={styles.shopDetailsSection}>
              <h3 className={styles.shopDetailsSectionTitle}>Store Details</h3>
              {locationEditing ? (
                <div className={styles.shopDetailsForm}>
                  {/* Address line */}
                  <label className={styles.formLabel}>
                    Street / House No.
                    <input
                      className={styles.formInput}
                      value={locationDraft.address_line}
                      onChange={(e) => setLocationDraft((d) => ({ ...d, address_line: e.target.value }))}
                      placeholder="e.g. 123 Rizal St., Unit 4B"
                    />
                  </label>

                  <label className={styles.formLabel}>
                    Barangay
                    <input
                      className={styles.formInput}
                      value={locationDraft.barangay}
                      onChange={(e) => setLocationDraft((d) => ({ ...d, barangay: e.target.value }))}
                      placeholder="e.g. Brgy. Sta. Cruz"
                    />
                  </label>

                  {/* PSGC region + city */}
                  <div className={styles.shopDetailsLocRow}>
                    <LocationSelects
                      value={locationDraft.city}
                      onChange={(city) => setLocationDraft((d) => ({ ...d, city }))}
                      selectClassName={styles.formInput}
                      labelClassName={styles.formLabel}
                      wrapClassName={styles.shopDetailsLocField}
                    />
                  </div>

                  {/* Province */}
                  {/* Contact number */}
                  <div className={styles.formLabel} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span>Contact Number</span>
                    <div className={styles.phoneRow}>
                      <span className={styles.phonePrefix}>+63</span>
                      <input
                        className={styles.phoneInput}
                        value={locationDraft.contact_number}
                        onChange={(e) => setLocationDraft((d) => ({ ...d, contact_number: formatLocalPhone(e.target.value) }))}
                        placeholder="912 345 6789"
                        inputMode="numeric"
                        maxLength={12}
                      />
                    </div>
                  </div>

                  {/* Operating days */}
                  <div className={styles.formLabel} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span>Operating Days</span>
                    <div className={styles.tickRow}>
                      {DAYS.map((d) => {
                        const active = locationDraft.available_days.includes(d);
                        return (
                          <button
                            key={d}
                            type="button"
                            className={`${styles.tickBtn} ${active ? styles.tickBtnActive : ""}`}
                            onClick={() => setLocationDraft((prev) => {
                              const set = new Set(prev.available_days);
                              if (set.has(d)) set.delete(d); else set.add(d);
                              return { ...prev, available_days: DAYS.filter((x) => set.has(x)) };
                            })}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={styles.formActions} style={{ marginTop: 10 }}>
                    <button className={styles.primaryBtn} disabled={locationSaving} onClick={() => void handleSaveLocation()}>
                      {locationSaving ? "Saving…" : "Save"}
                    </button>
                    <button className={styles.secondaryBtn} onClick={() => setLocationEditing(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className={styles.shopDetailsView}>
                  <div className={styles.shopDetailRow}>
                    <span className={styles.shopDetailLabel}>Address</span>
                    <span className={styles.shopDetailValue}>{merchant?.location ?? <em>Not set</em>}</span>
                  </div>
                  <div className={styles.shopDetailRow}>
                    <span className={styles.shopDetailLabel}>Contact</span>
                    <span className={styles.shopDetailValue}>{merchant?.contact_number ?? <em>Not set</em>}</span>
                  </div>
                  <div className={styles.shopDetailRow}>
                    <span className={styles.shopDetailLabel}>Open</span>
                    <span className={styles.shopDetailValue}>
                      {merchant?.operating_hours
                        ? (typeof merchant.operating_hours === "string" ? merchant.operating_hours : JSON.stringify(merchant.operating_hours))
                        : <em>Not set</em>}
                    </span>
                  </div>
                  <button
                    className={styles.uploadBtn}
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      const rawContact = merchant?.contact_number ?? "";
                      const localPart = rawContact.replace(/^\+63\s?/, "");
                      const oh = merchant?.operating_hours;
                      const ohStr = oh ? (typeof oh === "string" ? oh : JSON.stringify(oh)) : "";
                      const savedDays = ohStr.split(",").map((s) => s.trim()).filter((s) => DAYS.includes(s as typeof DAYS[number]));
                      setLocationDraft({
                        address_line: merchant?.location ?? "",
                        barangay: "",
                        city: "",
                        contact_number: formatLocalPhone(localPart),
                        available_days: savedDays,
                      });
                      setLocationEditing(true);
                    }}
                  >
                    Edit store details
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ORDERS ──────────────────────────────────────────────────────── */}
        {activeTab === "orders" && (
          <div className={styles.ordersLayout}>
            <div className={styles.ordersHeader}>
              <h2 className={styles.sectionTitle} style={{ margin: 0 }}>Customer Orders</h2>
              <div className={styles.orderFilterRow}>
                {["all", "pending", "processing", "shipped", "delivered", "cancelled"].map((f) => (
                  <button
                    key={f}
                    className={`${styles.filterChip} ${orderFilter === f ? styles.filterChipActive : ""}`}
                    onClick={() => setOrderFilter(f)}
                  >
                    {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.shipmentComposer}>
              <div>
                <h3 className={styles.shipmentComposerTitle}>Batch shipment</h3>
                <p className={styles.shipmentComposerText}>
                  Select processing orders from the same merchant run, then create one shipment with a computed stop sequence.
                </p>
              </div>
              <div className={styles.shipmentComposerActions}>
                <span className={styles.shipmentCounter}>
                  {selectedShipmentOrders.length} selected / {shipmentCandidates.length} eligible
                </span>
                <button
                  className={styles.primaryBtn}
                  disabled={shipmentCreating || selectedShipmentOrders.length === 0}
                  onClick={() => void handleCreateShipment()}
                >
                  {shipmentCreating ? "Creating shipment…" : "Create shipment"}
                </button>
              </div>
            </div>

            {shipmentMessage && (
              <div className={`${styles.payoutMessage} ${shipmentMessage.type === "success" ? styles.payoutMessageSuccess : styles.payoutMessageError}`}>
                {shipmentMessage.text}
              </div>
            )}

            <div className={styles.panel} style={{ marginBottom: 12 }}>
              <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Shipments</h3>
              {shipmentsLoading ? (
                <p className={styles.emptyText}>Loading shipments…</p>
              ) : shipmentsError ? (
                <p className={styles.emptyText} style={{ color: '#b91c1c' }}>{shipmentsError}</p>
              ) : shipments.length === 0 ? (
                <p className={styles.emptyText}>No shipments yet.</p>
              ) : (
                <ul className={styles.shipmentList}>
                  {shipments.map(s => (
                    <li key={s.id} className={styles.shipmentRow}>
                      <div>
                        <strong>Shipment #{s.id}</strong>
                        <div className={styles.shipmentMeta}>{s.stop_count} stops • {new Date(s.created_at).toLocaleString()}</div>
                      </div>
                      <div>
                        <button className={styles.secondaryBtn} onClick={() => viewShipment(s.id)}>View</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {ordersLoading && <p className={styles.emptyText}>Loading orders…</p>}
            {!ordersLoading && ordersError && <p className={styles.emptyText} style={{ color: "#b91c1c" }}>{ordersError}</p>}
            {!ordersLoading && !ordersError && orders.length === 0 && (
              <p className={styles.emptyText}>No orders yet.</p>
            )}

            <div className={styles.ordersList}>
              {orders
                .filter((o) => orderFilter === "all" || o.status === orderFilter)
                .map((order) => (
                  <div
                    key={order.id}
                    className={`${styles.orderCard} ${selectedShipmentOrderIds.has(order.id) ? styles.orderCardSelected : ""}`}
                  >
                    <div className={styles.orderCardHeader}>
                      <div className={styles.orderCardMeta}>
                        <span className={styles.orderIdLabel}>Order #{order.id}</span>
                        <span className={`${styles.orderStatusBadge} ${styles[`orderStatus_${order.status}`]}`}>
                          {order.status}
                        </span>
                        <span className={styles.orderDate}>{formatDate(order.ordered_at)}</span>
                      </div>
                      <strong className={styles.orderTotal}>{formatPeso(order.total_price)}</strong>
                    </div>

                    {shipmentCandidates.some((candidate) => candidate.id === order.id) && (
                      <label className={styles.orderSelectRow}>
                        <input
                          type="checkbox"
                          checked={selectedShipmentOrderIds.has(order.id)}
                          onChange={() => toggleShipmentOrder(order.id)}
                        />
                        <span>Select for shipment</span>
                      </label>
                    )}

                    {/* Buyer info */}
                    <div className={styles.orderBuyer}>
                      <span className={styles.orderBuyerLabel}>Buyer</span>
                      <span className={styles.orderBuyerName}>{order.buyer_name ?? "—"}</span>
                      {order.buyer_email && <span className={styles.orderBuyerContact}>{order.buyer_email}</span>}
                      {order.buyer_phone && <span className={styles.orderBuyerContact}>{order.buyer_phone}</span>}
                    </div>

                    {/* Delivery address */}
                    {order.delivery_address && (
                      <div className={styles.orderAddress}>
                        <span className={styles.orderBuyerLabel}>Deliver to</span>
                        <span>{order.delivery_address}</span>
                      </div>
                    )}

                    {/* Items */}
                    <div className={styles.orderItems}>
                      {order.items.map((item, i) => (
                        <div key={i} className={styles.orderItem}>
                          <span className={styles.orderItemName}>{item.produce ?? "Item"}</span>
                          <span className={styles.orderItemQty}>×{item.quantity}</span>
                          <span className={styles.orderItemPrice}>{item.price != null ? `₱${item.price}/${item.unit ?? "unit"}` : ""}</span>
                        </div>
                      ))}
                    </div>

                    {/* Status actions */}
                    {!["delivered", "cancelled"].includes(order.status) && (
                      <div className={styles.orderActions}>
                        {order.status === "pending" && (
                          <button className={styles.orderActionBtn} disabled={updatingOrderId === order.id} onClick={() => void handleUpdateOrderStatus(order.id, "processing")}>
                            {updatingOrderId === order.id ? "…" : "Confirm Order"}
                          </button>
                        )}
                        {order.status === 'shipped' && (
                          <button className={styles.orderActionBtn} disabled={updatingOrderId === order.id} onClick={() => void handleUpdateOrderStatus(order.id, 'delivered')}>
                            {updatingOrderId === order.id ? "…" : "Mark as Delivered"}
                          </button>
                        )}
                        {order.status !== "cancelled" && (
                          <button className={styles.orderCancelBtn} disabled={updatingOrderId === order.id} onClick={() => void handleUpdateOrderStatus(order.id, "cancelled")}>
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ── EARNINGS ────────────────────────────────────────────────────── */}
        {activeTab === "earnings" && (
          <div className={styles.earningsLayout}>
            {/* Summary cards */}
            <section className={styles.earningsGrid}>
              <div className={`${styles.kpiCard} ${styles.kpiCardAccent}`}>
                <span className={styles.kpiLabel}>Total Earned</span>
                <strong className={styles.kpiValue}>{formatPeso(earningsAnalytics.totalPaid)}</strong>
                <span className={styles.kpiSub}>from {transactions.filter((t) => t.status === "paid").length} paid transactions</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total Paid Out</span>
                <strong className={styles.kpiValue}>{formatPeso(earningsAnalytics.totalReleased)}</strong>
                <span className={styles.kpiSub}>released payouts</span>
              </div>
              <div className={`${styles.kpiCard} ${styles.kpiCardGreen}`}>
                <span className={styles.kpiLabel}>Available to Cash Out</span>
                <strong className={styles.kpiValue}>{formatPeso(earningsAnalytics.available)}</strong>
                <span className={styles.kpiSub}>net of released payouts</span>
              </div>
            </section>

            {payoutMessage && (
              <div className={`${styles.payoutMessage} ${payoutMessage.type === "success" ? styles.payoutMessageSuccess : styles.payoutMessageError}`}>
                {payoutMessage.text}
              </div>
            )}

            <div className={styles.earningsRow}>
              {/* Cash out panel */}
              <div className={styles.panel} style={{ flex: 1 }}>
                <h2 className={styles.panelTitle}>Cash Out</h2>

                {earningsAnalytics.pendingBatch ? (
                  <div className={styles.pendingPayout}>
                    <p className={styles.pendingPayoutText}>
                      You have a <strong>{earningsAnalytics.pendingBatch.status}</strong> payout request for{" "}
                      <strong>{formatPeso(earningsAnalytics.pendingBatch.gross_amount)}</strong> submitted on{" "}
                      {formatDate(earningsAnalytics.pendingBatch.created_at)}. Admin will process it shortly.
                    </p>
                  </div>
                ) : !payoutInfo && !payoutInfoEditing ? (
                  <div>
                    <p className={styles.emptyText} style={{ marginBottom: 12 }}>Set up your payout method to request a cash out.</p>
                    <button className={styles.primaryBtn} onClick={() => { setPayoutInfoDraft({ payout_type: "gcash", bank_code: "", account_number: "", account_name: "", ewallet_number: "" }); setPayoutInfoEditing(true); }}>Set Up Payout Method</button>
                  </div>
                ) : payoutInfoEditing ? (
                  <form onSubmit={(e) => void handleSavePayoutInfo(e)} className={styles.payoutForm}>
                    <label className={styles.formLabel}>
                      Payout Method
                      <select className={styles.formInput} value={payoutInfoDraft.payout_type} onChange={(e) => setPayoutInfoDraft((d) => ({ ...d, payout_type: e.target.value }))}>
                        <option value="gcash">GCash</option>
                        <option value="maya">Maya</option>
                        <option value="bank">Bank Transfer</option>
                      </select>
                    </label>
                    {payoutInfoDraft.payout_type === "bank" && (
                      <label className={styles.formLabel} style={{ marginTop: 8 }}>
                        Bank Code
                        <input className={styles.formInput} value={payoutInfoDraft.bank_code} onChange={(e) => setPayoutInfoDraft((d) => ({ ...d, bank_code: e.target.value }))} placeholder="BDO, BPI, UnionBank…" />
                      </label>
                    )}
                    <label className={styles.formLabel} style={{ marginTop: 8 }}>
                      Account Name
                      <input className={styles.formInput} value={payoutInfoDraft.account_name} onChange={(e) => setPayoutInfoDraft((d) => ({ ...d, account_name: e.target.value }))} placeholder="Full name on account" />
                    </label>
                    {payoutInfoDraft.payout_type === "bank" ? (
                      <label className={styles.formLabel} style={{ marginTop: 8 }}>
                        Account Number
                        <input className={styles.formInput} value={payoutInfoDraft.account_number} onChange={(e) => setPayoutInfoDraft((d) => ({ ...d, account_number: e.target.value }))} placeholder="Account number" />
                      </label>
                    ) : (
                      <label className={styles.formLabel} style={{ marginTop: 8 }}>
                        Mobile Number
                        <input className={styles.formInput} value={payoutInfoDraft.ewallet_number} onChange={(e) => setPayoutInfoDraft((d) => ({ ...d, ewallet_number: e.target.value }))} placeholder="+63 9XX XXX XXXX" />
                      </label>
                    )}
                    <div className={styles.formActions} style={{ marginTop: 12 }}>
                      <button type="submit" className={styles.primaryBtn} disabled={payoutInfoSaving}>{payoutInfoSaving ? "Saving…" : "Save Payout Method"}</button>
                      <button type="button" className={styles.secondaryBtn} onClick={() => setPayoutInfoEditing(false)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div>
                    <div className={styles.payoutInfoCard}>
                      <div className={styles.payoutInfoRow}>
                        <span className={styles.payoutInfoLabel}>Method</span>
                        <span className={styles.payoutInfoValue}>{payoutInfo!.payout_type.toUpperCase()}</span>
                      </div>
                      {payoutInfo!.account_name && (
                        <div className={styles.payoutInfoRow}>
                          <span className={styles.payoutInfoLabel}>Account Name</span>
                          <span className={styles.payoutInfoValue}>{payoutInfo!.account_name}</span>
                        </div>
                      )}
                      {payoutInfo!.bank_code && (
                        <div className={styles.payoutInfoRow}>
                          <span className={styles.payoutInfoLabel}>Bank</span>
                          <span className={styles.payoutInfoValue}>{payoutInfo!.bank_code}</span>
                        </div>
                      )}
                      {payoutInfo!.account_number && (
                        <div className={styles.payoutInfoRow}>
                          <span className={styles.payoutInfoLabel}>Account No.</span>
                          <span className={styles.payoutInfoValue}>{payoutInfo!.account_number}</span>
                        </div>
                      )}
                      {payoutInfo!.ewallet_number && (
                        <div className={styles.payoutInfoRow}>
                          <span className={styles.payoutInfoLabel}>Mobile</span>
                          <span className={styles.payoutInfoValue}>{payoutInfo!.ewallet_number}</span>
                        </div>
                      )}
                    </div>
                    <div className={styles.formActions} style={{ marginTop: 12 }}>
                      <button
                        className={styles.cashOutBtn}
                        disabled={requestingPayout || earningsAnalytics.available === 0}
                        onClick={() => void handleRequestPayout()}
                      >
                        {requestingPayout ? "Submitting…" : `Cash Out ${formatPeso(earningsAnalytics.available)}`}
                      </button>
                      <button className={styles.secondaryBtn} onClick={() => { setPayoutInfoDraft({ payout_type: payoutInfo!.payout_type, bank_code: payoutInfo!.bank_code ?? "", account_number: payoutInfo!.account_number ?? "", account_name: payoutInfo!.account_name ?? "", ewallet_number: payoutInfo!.ewallet_number ?? "" }); setPayoutInfoEditing(true); }}>Edit Method</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Recent transactions */}
              <div className={styles.panel} style={{ flex: 2 }}>
                <h2 className={styles.panelTitle}>Recent Transactions</h2>
                {transactions.length === 0 ? (
                  <p className={styles.emptyText}>No transactions yet.</p>
                ) : (
                  <table className={styles.txTable}>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Amount</th>
                        <th>Your Share</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.slice(0, 20).map((tx) => (
                        <tr key={tx.id}>
                          <td>#{tx.order_id}</td>
                          <td>{formatPeso(tx.amount)}</td>
                          <td>{formatPeso(tx.merchant_amount)}</td>
                          <td><span className={`${styles.txBadge} ${styles[`txBadge_${tx.status}`]}`}>{tx.status}</span></td>
                          <td>{formatDate(tx.paid_at ?? tx.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Payout history */}
            {payouts.length > 0 && (
              <div className={styles.panel}>
                <h2 className={styles.panelTitle}>Payout History</h2>
                <table className={styles.txTable}>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Transactions</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Released</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((p) => (
                      <tr key={p.id}>
                        <td>{formatDate(p.period_date)}</td>
                        <td>{p.transaction_count}</td>
                        <td>{formatPeso(p.gross_amount)}</td>
                        <td><span className={`${styles.txBadge} ${styles[`txBadge_${p.status}`]}`}>{p.status}</span></td>
                        <td>{formatDate(p.released_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className={styles.dangerZone}>
        <h3 className={styles.dangerTitle}>Danger Zone</h3>
        {!confirmDeleteMerchant ? (
          <button className={styles.dangerBtn} onClick={() => setConfirmDeleteMerchant(true)}>Delete merchant profile</button>
        ) : (
          <div className={styles.dangerConfirm}>
            <p className={styles.dangerWarning}>This will permanently delete your merchant profile, shop page, and all listed produce. Your order history will be preserved. This cannot be undone.</p>
            <div className={styles.dangerActions}>
              <button className={styles.dangerConfirmBtn} disabled={deletingMerchant} onClick={() => void handleDeleteMerchant()}>{deletingMerchant ? "Deleting…" : "Yes, delete my merchant profile"}</button>
              <button className={styles.secondaryBtn} disabled={deletingMerchant} onClick={() => setConfirmDeleteMerchant(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
