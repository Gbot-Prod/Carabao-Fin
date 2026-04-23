"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import {
  fetchMyMerchantPerformance,
  fetchMyProfile,
  fetchMerchantProduce,
  createProduce,
  updateProduce,
  deleteProduce,
  type MerchantPerformance,
  type Produce,
  type ProduceCreatePayload,
} from "@/util/api";

const formatPeso = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

const formatDateTime = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
};

type ProduceFormState = {
  name: string;
  description: string;
  category: string;
  price: number;
  unit: string;
  stock_quantity: number;
  image_url: string;
};

const emptyForm: ProduceFormState = {
  name: "",
  description: "",
  category: "",
  price: 0,
  unit: "kg",
  stock_quantity: 0,
  image_url: "",
};

function ProduceFormFields({
  form,
  onChange,
}: {
  form: ProduceFormState;
  onChange: (f: ProduceFormState) => void;
}) {
  return (
    <>
      <div className={styles.formGrid}>
        <label className={styles.formLabel}>
          Name *
          <input
            className={styles.formInput}
            type="text"
            required
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
          />
        </label>
        <label className={styles.formLabel}>
          Category
          <input
            className={styles.formInput}
            type="text"
            value={form.category}
            onChange={(e) => onChange({ ...form, category: e.target.value })}
          />
        </label>
        <label className={styles.formLabel}>
          Price (₱)
          <input
            className={styles.formInput}
            type="number"
            min="0"
            value={form.price}
            onChange={(e) => onChange({ ...form, price: Number(e.target.value) })}
          />
        </label>
        <label className={styles.formLabel}>
          Unit
          <input
            className={styles.formInput}
            type="text"
            value={form.unit}
            onChange={(e) => onChange({ ...form, unit: e.target.value })}
          />
        </label>
        <label className={styles.formLabel}>
          Stock quantity
          <input
            className={styles.formInput}
            type="number"
            min="0"
            value={form.stock_quantity}
            onChange={(e) => onChange({ ...form, stock_quantity: Number(e.target.value) })}
          />
        </label>
      </div>
      <label className={styles.formLabelFull}>
        Description
        <textarea
          className={styles.formInput}
          rows={2}
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
        />
      </label>
    </>
  );
}

export default function MerchantDashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMerchant, setIsMerchant] = useState<boolean | null>(null);
  const [performance, setPerformance] = useState<MerchantPerformance | null>(null);

  const [produces, setProduces] = useState<Produce[]>([]);
  const [produceLoading, setProduceLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<ProduceFormState>(emptyForm);
  const [editingProduceId, setEditingProduceId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ProduceFormState>(emptyForm);
  const [produceFormLoading, setProduceFormLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const profile = await fetchMyProfile();
        setIsMerchant(!!profile.merchant?.id);
      } catch {
        setIsMerchant(null);
      }

      try {
        const data = await fetchMyMerchantPerformance();
        setPerformance(data);
        setIsMerchant(true);
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: string }; status?: number } };
        const message = err?.response?.data?.detail || "Unable to load dashboard right now.";
        setError(String(message));
        if (err?.response?.status === 404) {
          setIsMerchant(false);
        }
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  useEffect(() => {
    if (!performance?.merchant_id) return;

    const loadProduces = async () => {
      setProduceLoading(true);
      try {
        const data = await fetchMerchantProduce(performance.merchant_id);
        setProduces(data);
      } catch {
        // silently fail — produce list will just be empty
      } finally {
        setProduceLoading(false);
      }
    };

    void loadProduces();
  }, [performance?.merchant_id]);

  const merchantName = performance?.merchant_name ?? "Your Shop";
  const ratingLabel = useMemo(() => {
    const rating = performance?.rating;
    if (rating === null || rating === undefined) return "—";
    return `${Number(rating).toFixed(1)} / 5`;
  }, [performance?.rating]);

  const startEdit = (p: Produce) => {
    setEditingProduceId(p.id);
    setEditForm({
      name: p.name ?? "",
      description: p.description ?? "",
      category: p.category ?? "",
      price: p.price,
      unit: p.unit,
      stock_quantity: p.stock_quantity,
      image_url: p.image_url ?? "",
    });
  };

  const handleAddProduce = async (e: React.FormEvent) => {
    e.preventDefault();
    setProduceFormLoading(true);
    try {
      const payload: ProduceCreatePayload = {
        name: addForm.name,
        description: addForm.description || null,
        category: addForm.category || null,
        price: addForm.price,
        unit: addForm.unit,
        stock_quantity: addForm.stock_quantity,
        image_url: addForm.image_url || null,
      };
      const created = await createProduce(payload);
      setProduces((prev) => [...prev, created]);
      setShowAddForm(false);
      setAddForm(emptyForm);
    } catch {
      // silently fail for now
    } finally {
      setProduceFormLoading(false);
    }
  };

  const handleUpdateProduce = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingProduceId === null) return;
    setProduceFormLoading(true);
    try {
      const updated = await updateProduce(editingProduceId, {
        name: editForm.name,
        description: editForm.description || null,
        category: editForm.category || null,
        price: editForm.price,
        unit: editForm.unit,
        stock_quantity: editForm.stock_quantity,
        image_url: editForm.image_url || null,
      });
      setProduces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setEditingProduceId(null);
    } catch {
      // silently fail for now
    } finally {
      setProduceFormLoading(false);
    }
  };

  const handleDeleteProduce = async (id: number) => {
    if (!window.confirm("Delete this produce item?")) return;
    try {
      await deleteProduce(id);
      setProduces((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // silently fail for now
    }
  };

  if (isLoading) {
    return (
      <div className={styles.page}>
        <section className={styles.card}>
          <h1 className={styles.title}>Merchant Dashboard</h1>
          <p className={styles.subtitle}>Loading your performance data…</p>
        </section>
      </div>
    );
  }

  if (isMerchant === false) {
    return (
      <div className={styles.page}>
        <section className={styles.card}>
          <h1 className={styles.title}>Merchant Dashboard</h1>
          <p className={styles.subtitle}>You don&apos;t have a merchant profile yet.</p>
          <div className={styles.actions}>
            <Link className={styles.primaryBtn} href="/merchantOnboarding">
              Apply as Merchant
            </Link>
            <Link className={styles.secondaryBtn} href="/profile">
              Back to Profile
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>{merchantName}</h1>
            <p className={styles.subtitle}>A quick snapshot of your shop performance.</p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.secondaryBtn} href="/profile">
              Settings
            </Link>
          </div>
        </header>

        {error && <p className={styles.errorBox}>{error}</p>}

        {performance && (
          <>
            <section className={styles.kpiGrid} aria-label="Key performance indicators">
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total revenue</span>
                <strong className={styles.kpiValue}>{formatPeso(performance.total_revenue)}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total orders</span>
                <strong className={styles.kpiValue}>{performance.total_orders}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Active orders</span>
                <strong className={styles.kpiValue}>{performance.active_orders}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Products listed</span>
                <strong className={styles.kpiValue}>{performance.total_products}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Rating</span>
                <strong className={styles.kpiValue}>{ratingLabel}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Last order</span>
                <strong className={styles.kpiValue}>{formatDateTime(performance.last_order_at) ?? "—"}</strong>
              </div>
            </section>

            <section className={styles.splitRow}>
              <div className={styles.panel}>
                <h2 className={styles.panelTitle}>Last 30 days</h2>
                <div className={styles.panelGrid}>
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

              <div className={styles.panel}>
                <h2 className={styles.panelTitle}>Order status</h2>
                <div className={styles.panelGrid}>
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
            </section>
          </>
        )}

        {/* Produce management */}
        <section className={styles.produceSection}>
          <div className={styles.produceSectionHeader}>
            <h2 className={styles.panelTitle} style={{ margin: 0 }}>Your Produce</h2>
            {!showAddForm && (
              <button
                className={styles.primaryBtn}
                onClick={() => { setShowAddForm(true); setEditingProduceId(null); }}
              >
                + Add Produce
              </button>
            )}
          </div>

          {showAddForm && (
            <form onSubmit={(e) => void handleAddProduce(e)} className={styles.produceForm}>
              <p className={styles.formTitle}>New produce</p>
              <ProduceFormFields form={addForm} onChange={setAddForm} />
              <div className={styles.formActions}>
                <button type="submit" className={styles.primaryBtn} disabled={produceFormLoading}>
                  {produceFormLoading ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => { setShowAddForm(false); setAddForm(emptyForm); }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {produceLoading && <p className={styles.produceEmpty}>Loading produce…</p>}

          {!produceLoading && produces.length === 0 && !showAddForm && (
            <p className={styles.produceEmpty}>No produce listed yet. Add your first item above.</p>
          )}

          <div className={styles.produceList}>
            {produces.map((produce) =>
              editingProduceId === produce.id ? (
                <form
                  key={produce.id}
                  onSubmit={(e) => void handleUpdateProduce(e)}
                  className={styles.produceForm}
                >
                  <p className={styles.formTitle}>Edit: {produce.name}</p>
                  <ProduceFormFields form={editForm} onChange={setEditForm} />
                  <div className={styles.formActions}>
                    <button type="submit" className={styles.primaryBtn} disabled={produceFormLoading}>
                      {produceFormLoading ? "Saving…" : "Save changes"}
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => setEditingProduceId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div key={produce.id} className={styles.produceRow}>
                  <div className={styles.produceRowInfo}>
                    <strong className={styles.produceName}>{produce.name}</strong>
                    {produce.category && (
                      <span className={styles.produceCategory}>{produce.category}</span>
                    )}
                    <span className={styles.producePrice}>
                      ₱{produce.price} / {produce.unit}
                    </span>
                    <span className={styles.produceStock}>Stock: {produce.stock_quantity}</span>
                    {produce.description && (
                      <p className={styles.produceDesc}>{produce.description}</p>
                    )}
                  </div>
                  <div className={styles.produceRowActions}>
                    <button className={styles.secondaryBtn} onClick={() => startEdit(produce)}>
                      Edit
                    </button>
                    <button
                      className={styles.dangerBtn}
                      onClick={() => void handleDeleteProduce(produce.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </section>

        <footer className={styles.footer}>
          <Link className={styles.secondaryBtn} href="/track">
            View orders
          </Link>
          <Link className={styles.secondaryBtn} href="/merchantOnboarding">
            Update merchant details
          </Link>
        </footer>
      </section>
    </div>
  );
}
