"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import { fetchMyCart, replaceMyCart } from "@/util/api";
import { cartTotals, groupCartByMerchant } from "@/util/cartGroups";

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
};

export default function CartPage() {
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
              price: Number(item.price) || 0,
              min_order_qty: item.min_order_qty,
              merchant_id: item.merchant_id,
              delivery_fee: item.delivery_fee,
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
                    min_order_qty: s.min_order_qty,
                    merchant_id: s.merchant_id,
                    delivery_fee: s.delivery_fee,
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
  const { itemTotal, deliveryTotal, grandTotal } = cartTotals(groups);

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
        <h1>Your Cart</h1>
        <p>Review your produce before proceeding to checkout.</p>
      </header>

      <div className={styles.layout}>
        <section className={styles.itemsCard}>
          {isHydrating ? (
            <PageLoader variant="inline" label="Loading your cart…" />
          ) : items.length === 0 ? (
            <div className={styles.emptyState}>
              <h2>Your cart is empty</h2>
              <p>Add products from farms to place an order.</p>
              <Link href="/order" className={styles.secondaryButton}>
                Browse Farms
              </Link>
            </div>
          ) : (
            <div className={styles.groupList}>
              {groups.map((group) => (
                <section key={group.key} className={styles.farmGroup} aria-label={`Items from ${group.farm}`}>
                  <header className={styles.farmGroupHeader}>
                    <h2 className={styles.farmGroupName}>{group.farm}</h2>
                    <span className={styles.farmGroupMeta}>
                      {group.items.length} item{group.items.length === 1 ? "" : "s"} · delivery PHP {group.deliveryFee.toFixed(2)}
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
                        </div>

                        <div className={styles.itemActions}>
                          <div className={styles.qtyControl}>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              aria-label={`Decrease quantity for ${item.produce}`}
                              disabled={item.quantity <= (item.min_order_qty ?? 1)}
                            >
                              -
                            </button>
                            <span>{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              aria-label={`Increase quantity for ${item.produce}`}
                              disabled={item.stock_quantity !== undefined && item.quantity >= item.stock_quantity}
                            >
                              +
                            </button>
                          </div>
                          {(item.min_order_qty ?? 1) > 1 && (
                            <p className={styles.priceLine}>Min. order {item.min_order_qty}</p>
                          )}

                          <p className={styles.lineTotal}>
                            PHP {(item.quantity * item.price).toFixed(2)}
                          </p>

                          <button
                            type="button"
                            className={styles.removeButton}
                            onClick={() => removeItem(item.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className={styles.farmGroupTotal}>
                    Subtotal for {group.farm}: <strong>PHP {group.total.toFixed(2)}</strong>
                  </p>
                </section>
              ))}
            </div>
          )}
        </section>

        <aside className={styles.summaryCard}>
          <h2>Order Summary</h2>
          <div className={styles.summaryLine}>
            <span>Items total</span>
            <strong>PHP {itemTotal.toFixed(2)}</strong>
          </div>
          <div className={styles.summaryLine}>
            <span>Delivery fees{groups.length > 1 ? ` (${groups.length} farms)` : ""}</span>
            <strong>PHP {deliveryTotal.toFixed(2)}</strong>
          </div>
          {groups.length > 1 && (
            <p className={styles.multiFarmNote}>
              Each farm delivers and is paid separately, so checkout creates {groups.length} orders and you pay
              for each in turn.
            </p>
          )}
          <div className={styles.summaryLineGrand}>
            <span>Grand total</span>
            <strong>PHP {grandTotal.toFixed(2)}</strong>
          </div>

          <div className={styles.summaryActions}>
            <Link
              href={items.length === 0 ? "/order" : "/checkout"}
              className={styles.primaryButton}
            >
              {items.length === 0 ? "Add Products" : "Proceed to Checkout"}
            </Link>
            <Link href="/order" className={styles.secondaryButton}>
              Continue Shopping
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
