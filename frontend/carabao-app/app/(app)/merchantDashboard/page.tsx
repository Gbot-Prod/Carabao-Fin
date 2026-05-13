"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { useRouter } from "next/navigation";
import {
  fetchMyMerchantPerformance,
  fetchMerchantProduce,
  fetchMerchantShopPage,
  fetchMyPayoutInfo,
  fetchMyPayouts,
  fetchMyTransactions,
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
  type MerchantPerformance,
  type Produce,
  type ShopPage,
  type ProduceCreatePayload,
  type PayoutInfo,
  type MerchantMerchantPayoutBatch,
  type MerchantTransaction,
} from "@/util/api";

const formatPeso = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

const formatDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
};

type Tab = "overview" | "produce" | "shop" | "earnings";

type ProduceFormState = {
  name: string; description: string; category: string;
  price: number; unit: string; stock_quantity: number; image_url: string;
};

const emptyForm: ProduceFormState = { name: "", description: "", category: "", price: 0, unit: "kg", stock_quantity: 0, image_url: "" };

function ProduceFormFields({ form, onChange }: { form: ProduceFormState; onChange: (f: ProduceFormState) => void }) {
  return (
    <>
      <div className={styles.formGrid}>
        <label className={styles.formLabel}>Name *<input className={styles.formInput} required value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} /></label>
        <label className={styles.formLabel}>Category<input className={styles.formInput} value={form.category} onChange={(e) => onChange({ ...form, category: e.target.value })} /></label>
        <label className={styles.formLabel}>Price (₱)<input className={styles.formInput} type="number" min="0" value={form.price} onChange={(e) => onChange({ ...form, price: Number(e.target.value) })} /></label>
        <label className={styles.formLabel}>Unit<input className={styles.formInput} value={form.unit} onChange={(e) => onChange({ ...form, unit: e.target.value })} /></label>
        <label className={styles.formLabel}>Stock<input className={styles.formInput} type="number" min="0" value={form.stock_quantity} onChange={(e) => onChange({ ...form, stock_quantity: Number(e.target.value) })} /></label>
      </div>
      <label className={styles.formLabelFull}>Description<textarea className={styles.formInput} rows={2} value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} /></label>
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
        const [produceData, shopPageData] = await Promise.allSettled([
          fetchMerchantProduce(performance.merchant_id),
          fetchMerchantShopPage(performance.merchant_id),
        ]);
        if (produceData.status === "fulfilled") setProduces(produceData.value);
        if (shopPageData.status === "fulfilled") setShopPage(shopPageData.value);
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

  const ratingLabel = useMemo(() => {
    const r = performance?.rating;
    return r == null ? "—" : `${Number(r).toFixed(1)} / 5`;
  }, [performance?.rating]);

  // ── Produce handlers ────────────────────────────────────────────────────────

  const startEdit = (p: Produce) => {
    setEditingProduceId(p.id);
    setEditForm({ name: p.name ?? "", description: p.description ?? "", category: p.category ?? "", price: p.price, unit: p.unit, stock_quantity: p.stock_quantity, image_url: p.image_url ?? "" });
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
      const payload: ProduceCreatePayload = { name: addForm.name, description: addForm.description || null, category: addForm.category || null, price: addForm.price, unit: addForm.unit, stock_quantity: addForm.stock_quantity, image_url: addForm.image_url || null };
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
      const updated = await updateProduce(editingProduceId, { name: editForm.name, description: editForm.description || null, category: editForm.category || null, price: editForm.price, unit: editForm.unit, stock_quantity: editForm.stock_quantity, image_url: editForm.image_url || null });
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
        {(["overview", "produce", "shop", "earnings"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`${styles.tabBtn} ${activeTab === tab ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "overview" && "Overview"}
            {tab === "produce" && `Produce (${produces.length})`}
            {tab === "shop" && "Shop Page"}
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
              <Link className={styles.secondaryBtn} href="/track">View Orders</Link>
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
                      <span className={styles.producePrice}>₱{produce.price} / {produce.unit}</span>
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
