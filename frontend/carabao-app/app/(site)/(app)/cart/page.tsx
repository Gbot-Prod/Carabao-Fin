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
import { blockingLineCount, cartIssueMessage, type CartIssue } from "@/lib/cart-issues";

type CartItem = {
  id: string;
  farm: string;
  produce: string;
  unit: string;
  quantity: number;
  price: number;
  stock_quantity?: number;
  min_order_qty?: number;
  merchant_id?: number | null;
  delivery_fee?: number | null;
  issue?: CartIssue | null;
  previous_price?: number | null;
};

// Fields only the server knows (CF-0042): live stock, price, and why checkout
// would refuse the line.
type ServerLine = {
  price: number;
  min_order_qty?: number;
  merchant_id?: number | null;
  delivery_fee?: number | null;
  farm: string;
  stock_quantity?: number;
  issue?: CartIssue | null;
  previous_price?: number | null;
};

const serverFields = (s: ServerLine) => ({
  price: Number(s.price) || 0,
  min_order_qty: s.min_order_qty,
  merchant_id: s.merchant_id,
  delivery_fee: s.delivery_fee,
  stock_quantity: s.stock_quantity,
  issue: s.issue ?? null,
  previous_price: s.previous_price ?? null,
});

export default function CartPage() {
  const { t } = useLanguage();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [isHydrating, setIsHydrating] = useState(true);
  const hasSyncedRef = useRef(false);

  useEffect(() => {
    const loadCart = async () => {
      try {
        const cart = await fetchMyCart();
        if (Array.isArray(cart.items)) {
          setItems(
            cart.items.map((item) => ({
              id: String(item.id),
              farm: item.farm,
              produce: item.produce,
              unit: item.unit,
              quantity: Number(item.quantity) || 0,
              ...serverFields(item),
            })),
          );
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
              (s.merchant_id ?? null) !== (item.merchant_id ?? null) ||
              (s.delivery_fee ?? null) !== (item.delivery_fee ?? null) ||
              s.farm !== item.farm ||
              s.stock_quantity !== item.stock_quantity ||
              (s.issue ?? null) !== (item.issue ?? null) ||
              (s.previous_price ?? null) !== (item.previous_price ?? null))
          );
        });
        if (changed) {
          setItems((prev) =>
            prev.map((item) => {
              const s = fromServer.get(item.id);
              return s
                ? { ...item, ...serverFields(s), farm: s.farm || item.farm }
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
  const { itemTotal, deliveryTotal, grandTotal } = cartTotals(groups);
  // Place-order refuses the whole cart while any line has an issue (CF-0042).
  const blocked = blockingLineCount(items) > 0;

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

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{t.cart.title}</h1>
        <p>{t.cart.subtitle}</p>
      </header>

      <div className={styles.layout}>
        <section className={styles.itemsCard}>
          {isHydrating || authLoading ? (
            <SkeletonList label={t.cart.loading} rows={3} thumbnail />
          ) : !isAuthenticated ? (
            <div className={styles.emptyState}>
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
            <div className={styles.emptyState}>
              <h2>{t.cart.emptyTitle}</h2>
              <p>{t.cart.emptyBody}</p>
              <Link href="/order" className={styles.secondaryButton}>
                {t.cart.browseFarms}
              </Link>
            </div>
          ) : (
            <div className={styles.groupList}>
              {groups.map((group) => (
                <section key={group.key} className={styles.farmGroup} aria-label={fmt(t.cart.itemsFrom, { farm: group.farm })}>
                  <header className={styles.farmGroupHeader}>
                    <h2 className={styles.farmGroupName}>{group.farm}</h2>
                    <span className={styles.farmGroupMeta}>
                      {plural(group.items.length, t.cart.itemCountOne, t.cart.itemCountMany)} ·{" "}
                      {fmt(t.cart.groupDelivery, { fee: group.deliveryFee.toFixed(2) })}
                    </span>
                  </header>
                  <ul className={styles.itemList}>
                    {group.items.map((item) => (
                      <li key={item.id} className={styles.itemRow}>
                        <div className={styles.itemMeta}>
                          <h3>{item.produce}</h3>
                          <p className={styles.priceLine}>
                            PHP {item.price.toFixed(2)} / {item.unit}
                          </p>
                          {item.previous_price != null && item.previous_price !== item.price && (
                            <p className={styles.priceChanged}>
                              {fmt(t.cart.priceChanged, { old: item.previous_price.toFixed(2) })}
                            </p>
                          )}
                          {item.issue && (
                            <p className={styles.lineIssue} role="alert">
                              {cartIssueMessage(item, t.cart)}
                            </p>
                          )}
                        </div>

                        <div className={styles.itemActions}>
                          <div className={styles.qtyControl}>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              aria-label={fmt(t.cart.decrease, { name: item.produce })}
                              disabled={item.quantity <= (item.min_order_qty ?? 1)}
                            >
                              -
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
                          {(item.min_order_qty ?? 1) > 1 && (
                            <p className={styles.priceLine}>{fmt(t.cart.minOrder, { qty: item.min_order_qty ?? 1 })}</p>
                          )}

                          <p className={styles.lineTotal}>
                            PHP {(item.quantity * item.price).toFixed(2)}
                          </p>

                          <button
                            type="button"
                            className={styles.removeButton}
                            onClick={() => removeItem(item.id)}
                          >
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
              ))}
            </div>
          )}
        </section>

        <aside className={styles.summaryCard}>
          <h2>{t.cart.summary}</h2>
          <div className={styles.summaryLine}>
            <span>{t.cart.itemsTotal}</span>
            <strong>PHP {itemTotal.toFixed(2)}</strong>
          </div>
          <div className={styles.summaryLine}>
            <span>{groups.length > 1 ? fmt(t.cart.deliveryFeesFarms, { count: groups.length }) : t.cart.deliveryFees}</span>
            <strong>PHP {deliveryTotal.toFixed(2)}</strong>
          </div>
          {groups.length > 1 && (
            <p className={styles.multiFarmNote}>{fmt(t.cart.multiFarmNote, { count: groups.length })}</p>
          )}
          <div className={styles.summaryLineGrand}>
            <span>{t.cart.grandTotal}</span>
            <strong>PHP {grandTotal.toFixed(2)}</strong>
          </div>

          {blocked && <p className={styles.lineIssue}>{t.cart.fixIssues}</p>}
          <div className={styles.summaryActions}>
            {blocked ? (
              <span className={styles.primaryButton} aria-disabled="true" data-disabled="true">
                {t.cart.proceed}
              </span>
            ) : (
              <Link
                href={items.length === 0 ? "/order" : "/checkout"}
                className={styles.primaryButton}
              >
                {items.length === 0 ? t.cart.addProducts : t.cart.proceed}
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
