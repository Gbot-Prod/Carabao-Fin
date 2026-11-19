"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import SkeletonList from "@/components/Skeleton/Skeleton";
import { fetchMyCart, replaceMyCart } from "@/util/api";
import { cartTotals, groupCartByMerchant } from "@/util/cartGroups";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt, plural } from "@/lib/i18n/format";
import { useAuth } from "@/hooks/useAuth";
import { cartIssueMessage, type CartIssue } from "@/lib/cart-issues";

type CartItem = {
  id: string;
  farm: string;
  produce: string;
  unit: string;
  quantity: number;
  price: number;
  image?: string | null;
  stock_quantity?: number;
  min_order_qty?: number;
  merchant_id?: number | null;
  delivery_fee?: number | null;
  unavailable_reason?: string | null;
  // CF-0042: the same check as a code (plus exceeds_stock), and the price
  // when the buyer last saved the line, when it has changed since.
  issue?: CartIssue | null;
  previous_price?: number | null;
};

// A checkbox that also shows the "some ticked" state.
function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={styles.checkbox}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
    />
  );
}

export default function CartPage() {
  const { t } = useLanguage();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  // Ticked cart lines, by item id. Only these go to checkout.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isHydrating, setIsHydrating] = useState(true);
  const hasSyncedRef = useRef(false);

  useEffect(() => {
    const loadCart = async () => {
      try {
        const cart = await fetchMyCart();
        if (Array.isArray(cart.items)) {
          const loaded = cart.items.map((item) => ({
            id: String(item.id),
            farm: item.farm,
            produce: item.produce,
            unit: item.unit,
            quantity: Number(item.quantity) || 0,
            price: Number(item.price) || 0,
            image: item.image,
            stock_quantity: item.stock_quantity,
            min_order_qty: item.min_order_qty,
            merchant_id: item.merchant_id,
            delivery_fee: item.delivery_fee,
            unavailable_reason: item.unavailable_reason ?? null,
            issue: item.issue ?? null,
            previous_price: item.previous_price ?? null,
          }));
          setItems(loaded);
          // Every line checkout accepts starts ticked (CF-0052).
          setSelected(new Set(loaded.filter((item) => !item.unavailable_reason).map((item) => item.id)));
        }
      } catch {
        // Keep local defaults when backend is unavailable.
      } finally {
        setIsHydrating(false);
      }
    };

    void loadCart();
  }, []);

  useEffect(() => {
    if (isHydrating) {
      return;
    }

    if (!hasSyncedRef.current) {
      hasSyncedRef.current = true;
      return;
    }

    const persistCart = async () => {
      try {
        const saved = await replaceMyCart(items);
        // The server sets each line's price (bulk tiers) and minimum order.
        const fromServer = new Map(saved.items.map((i) => [String(i.id), i]));
        const changed = items.some((item) => {
          const s = fromServer.get(item.id);
          return (
            s !== undefined &&
            (Number(s.price) !== item.price ||
              s.min_order_qty !== item.min_order_qty ||
              s.stock_quantity !== item.stock_quantity ||
              (s.image ?? null) !== (item.image ?? null) ||
              (s.merchant_id ?? null) !== (item.merchant_id ?? null) ||
              (s.delivery_fee ?? null) !== (item.delivery_fee ?? null) ||
              (s.unavailable_reason ?? null) !== (item.unavailable_reason ?? null) ||
              (s.issue ?? null) !== (item.issue ?? null) ||
              (s.previous_price ?? null) !== (item.previous_price ?? null) ||
              s.farm !== item.farm)
          );
        });
        if (changed) {
          setItems((prev) =>
            prev.map((item) => {
              const s = fromServer.get(item.id);
              return s
                ? {
                    ...item,
                    price: Number(s.price) || 0,
                    image: s.image,
                    stock_quantity: s.stock_quantity,
                    min_order_qty: s.min_order_qty,
                    merchant_id: s.merchant_id,
                    delivery_fee: s.delivery_fee,
                    unavailable_reason: s.unavailable_reason ?? null,
                    issue: s.issue ?? null,
                    previous_price: s.previous_price ?? null,
                    farm: s.farm || item.farm,
                  }
                : item;
            }),
          );
        }
      } catch {
        // Keep UI responsive even when save fails.
      }
    };

    void persistCart();
  }, [items, isHydrating]);

  // One order per farm at checkout (C1), each with its own delivery fee.
  const groups = useMemo(() => groupCartByMerchant(items), [items]);
  // The summary counts only the ticked lines: that is what checkout will order.
  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);
  const selectedGroups = useMemo(() => groupCartByMerchant(selectedItems), [selectedItems]);
  const { itemTotal, deliveryTotal, grandTotal } = cartTotals(selectedGroups);

  const allSelected = items.length > 0 && selectedItems.length === items.length;
  const someSelected = selectedItems.length > 0 && !allSelected;

  const setTicked = (ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const updateQuantity = (id: string, nextQuantity: number) => {
    if (nextQuantity < 1) return;
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (nextQuantity < (item.min_order_qty ?? 1)) return item;
        const max = item.stock_quantity ?? Infinity;
        return { ...item, quantity: Math.min(nextQuantity, max) };
      }),
    );
  };

  const removeItems = (ids: string[]) => {
    const drop = new Set(ids);
    setItems((prev) => prev.filter((item) => !drop.has(item.id)));
    setTicked(ids, false);
  };

  // All ticked: plain /checkout (whole cart). Otherwise name the ticked lines.
  const checkoutHref = allSelected
    ? "/checkout"
    : `/checkout?items=${selectedItems.map((item) => item.id).join(",")}`;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{t.cart.title}</h1>
        <p>{t.cart.subtitle}</p>
      </header>

      <div className={styles.layout}>
        <section className={styles.itemsColumn}>
          {isHydrating || authLoading ? (
            <div className={styles.card}>
              <SkeletonList label={t.cart.loading} rows={3} thumbnail />
            </div>
          ) : !isAuthenticated ? (
            <div className={`${styles.card} ${styles.emptyState}`}>
              <h2>{t.cart.signedOutTitle}</h2>
              <p>{t.cart.signedOutBody}</p>
              <Link href="/auth" className={styles.primaryButton}>
                {t.authPrompt.signIn}
              </Link>
              <Link href="/auth?mode=signup" className={styles.secondaryButton}>
                {t.authPrompt.signUp}
              </Link>
            </div>
          ) : items.length === 0 ? (
            <div className={`${styles.card} ${styles.emptyState}`}>
              <h2>{t.cart.emptyTitle}</h2>
              <p>{t.cart.emptyBody}</p>
              <Link href="/order" className={styles.secondaryButton}>
                {t.cart.browseFarms}
              </Link>
            </div>
          ) : (
            <>
              <div className={`${styles.card} ${styles.tableHead}`}>
                <label className={styles.selectCell}>
                  <TriCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={(on) => setTicked(items.map((item) => item.id), on)}
                    label={fmt(t.cart.selectAll, { count: items.length })}
                  />
                  <span className={styles.selectAllText}>{fmt(t.cart.selectAll, { count: items.length })}</span>
                </label>
                <span className={styles.colProduct}>{t.cart.colProduct}</span>
                <span className={styles.colNum}>{t.cart.colUnitPrice}</span>
                <span className={styles.colNum}>{t.cart.colQuantity}</span>
                <span className={styles.colNum}>{t.cart.colTotal}</span>
                <span className={styles.colNum}>{t.cart.colActions}</span>
              </div>

              {groups.map((group) => {
                const ids = group.items.map((item) => item.id);
                const ticked = ids.filter((id) => selected.has(id)).length;
                return (
                  <section
                    key={group.key}
                    className={`${styles.card} ${styles.farmGroup}`}
                    aria-label={fmt(t.cart.itemsFrom, { farm: group.farm })}
                  >
                    <header className={styles.farmGroupHeader}>
                      <label className={styles.selectCell}>
                        <TriCheckbox
                          checked={ticked === ids.length}
                          indeterminate={ticked > 0}
                          onChange={(on) => setTicked(ids, on)}
                          label={fmt(t.cart.selectFarm, { farm: group.farm })}
                        />
                      </label>
                      <svg className={styles.shopIcon} viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9M3 10l1.5-5h15L21 10M3 10a3 3 0 0 0 6 0m0 0a3 3 0 0 0 6 0m0 0a3 3 0 0 0 6 0M10 20v-5h4v5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {group.merchantId != null ? (
                        <Link href={`/farms/${group.merchantId}`} className={styles.farmGroupName}>
                          {group.farm}
                        </Link>
                      ) : (
                        <span className={styles.farmGroupName}>{group.farm}</span>
                      )}
                      <span className={styles.farmGroupMeta}>
                        {plural(group.items.length, t.cart.itemCountOne, t.cart.itemCountMany)} ·{" "}
                        {fmt(t.cart.groupDelivery, { fee: group.deliveryFee.toFixed(2) })}
                      </span>
                    </header>

                    <ul className={styles.itemList}>
                      {group.items.map((item) => (
                        <li key={item.id} className={styles.itemRow}>
                          <label className={styles.selectCell}>
                            <TriCheckbox
                              checked={selected.has(item.id)}
                              onChange={(on) => setTicked([item.id], on)}
                              label={fmt(t.cart.selectItem, { name: item.produce })}
                            />
                          </label>

                          <div className={styles.product}>
                            {item.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.image} alt="" className={styles.thumb} loading="lazy" />
                            ) : (
                              <div className={styles.thumbPlaceholder} aria-hidden="true" />
                            )}
                            <div className={styles.itemMeta}>
                              <h3>{item.produce}</h3>
                              <p className={styles.unitLine}>{item.unit}</p>
                              {(item.min_order_qty ?? 1) > 1 && (
                                <p className={styles.unitLine}>{fmt(t.cart.minOrder, { qty: item.min_order_qty ?? 1 })}</p>
                              )}
                              {item.unavailable_reason && (
                                <p className={styles.unavailable} role="note">
                                  {item.produce} {item.unavailable_reason}. Remove it to check out.
                                </p>
                              )}
                              {/* CF-0042: more stock wanted than is left (not in unavailable_reason). */}
                              {item.issue === "exceeds_stock" && (
                                <p className={styles.lineIssue} role="note">
                                  {cartIssueMessage(item, t.cart)}
                                </p>
                              )}
                              {item.previous_price != null && item.previous_price !== item.price && (
                                <p className={styles.priceChanged}>
                                  {fmt(t.cart.priceChanged, { old: item.previous_price.toFixed(2) })}
                                </p>
                              )}
                            </div>
                          </div>

                          <p className={styles.unitPrice}>
                            <span className={styles.mobileLabel}>{t.cart.colUnitPrice}: </span>
                            PHP {item.price.toFixed(2)}
                          </p>

                          <div className={styles.qtyCell}>
                            <div className={styles.qtyControl}>
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                aria-label={fmt(t.cart.decrease, { name: item.produce })}
                                disabled={item.quantity <= (item.min_order_qty ?? 1)}
                              >
                                −
                              </button>
                              <span>{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                aria-label={fmt(t.cart.increase, { name: item.produce })}
                                disabled={item.stock_quantity !== undefined && item.quantity >= item.stock_quantity}
                              >
                                +
                              </button>
                            </div>
                          </div>

                          <p className={styles.lineTotal}>PHP {(item.quantity * item.price).toFixed(2)}</p>

                          <div className={styles.actionsCell}>
                            <button type="button" className={styles.removeButton} onClick={() => removeItems([item.id])}>
                              {t.cart.remove}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>

                    <p className={styles.farmGroupTotal}>
                      {fmt(t.cart.farmSubtotal, { farm: group.farm })} <strong>PHP {group.total.toFixed(2)}</strong>
                    </p>
                  </section>
                );
              })}

              <div className={`${styles.card} ${styles.bulkBar}`}>
                <label className={styles.selectCell}>
                  <TriCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={(on) => setTicked(items.map((item) => item.id), on)}
                    label={fmt(t.cart.selectAll, { count: items.length })}
                  />
                  <span>{fmt(t.cart.selectAll, { count: items.length })}</span>
                </label>
                <span className={styles.selectedCount}>{fmt(t.cart.selectedCount, { count: selectedItems.length })}</span>
                <button
                  type="button"
                  className={styles.removeButton}
                  disabled={selectedItems.length === 0}
                  onClick={() => removeItems(selectedItems.map((item) => item.id))}
                >
                  {t.cart.removeSelected}
                </button>
              </div>
            </>
          )}
        </section>

        <aside className={`${styles.card} ${styles.summaryCard}`}>
          <h2>{t.cart.summary}</h2>
          <div className={styles.summaryLine}>
            <span>{t.cart.itemsTotal}</span>
            <strong>PHP {itemTotal.toFixed(2)}</strong>
          </div>
          <div className={styles.summaryLine}>
            <span>
              {selectedGroups.length > 1
                ? fmt(t.cart.deliveryFeesFarms, { count: selectedGroups.length })
                : t.cart.deliveryFees}
            </span>
            <strong>PHP {deliveryTotal.toFixed(2)}</strong>
          </div>
          {selectedGroups.length > 1 && (
            <p className={styles.multiFarmNote}>{fmt(t.cart.multiFarmNote, { count: selectedGroups.length })}</p>
          )}
          <div className={styles.summaryLineGrand}>
            <span>{t.cart.grandTotal}</span>
            <strong>PHP {grandTotal.toFixed(2)}</strong>
          </div>

          {items.length > 0 && selectedItems.length === 0 && (
            <p className={styles.multiFarmNote}>{t.cart.noneSelected}</p>
          )}

          <div className={styles.summaryActions}>
            {items.length === 0 ? (
              <Link href="/order" className={styles.primaryButton}>
                {t.cart.addProducts}
              </Link>
            ) : selectedItems.length === 0 ? (
              <button type="button" className={styles.primaryButton} disabled>
                {t.cart.proceed}
              </button>
            ) : (
              <Link href={checkoutHref} className={styles.primaryButton}>
                {t.cart.proceed} ({selectedItems.length})
              </Link>
            )}
            <Link href="/order" className={styles.secondaryButton}>
              {t.cart.continueShopping}
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
