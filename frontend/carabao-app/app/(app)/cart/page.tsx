"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import { fetchMyCart, replaceMyCart } from "@/util/api";

type CartItem = {
  id: string;
  farm: string;
  produce: string;
  unit: string;
  quantity: number;
  price: number;
};

const initialItems: CartItem[] = [
  {
    id: "it-1",
    farm: "Green Valley Farm",
    produce: "Organic Eggplant",
    unit: "kg",
    quantity: 3,
    price: 85,
  },
  {
    id: "it-2",
    farm: "Highland Harvest",
    produce: "Heirloom Tomato",
    unit: "kg",
    quantity: 2,
    price: 120,
  },
  {
    id: "it-3",
    farm: "Riverside Growers",
    produce: "Fresh Okra",
    unit: "kg",
    quantity: 1,
    price: 70,
  },
];

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>(initialItems);
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
        await replaceMyCart(items);
      } catch {
        // Keep UI responsive even when save fails.
      }
    };

    void persistCart();
  }, [items, isHydrating]);

  const itemTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.price, 0),
    [items],
  );
  const serviceFee = useMemo(() => (itemTotal > 0 ? 40 : 0), [itemTotal]);
  const grandTotal = itemTotal + serviceFee;

  const updateQuantity = (id: string, nextQuantity: number) => {
    if (nextQuantity < 1) {
      return;
    }
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, quantity: nextQuantity } : item,
      ),
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
          {items.length === 0 ? (
            <div className={styles.emptyState}>
              <h2>Your cart is empty</h2>
              <p>Add products from farms to place an order.</p>
              <Link href="/order" className={styles.secondaryButton}>
                Browse Farms
              </Link>
            </div>
          ) : (
            <ul className={styles.itemList}>
              {items.map((item) => (
                <li key={item.id} className={styles.itemRow}>
                  <div className={styles.itemMeta}>
                    <p className={styles.farm}>{item.farm}</p>
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
                      >
                        -
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        aria-label={`Increase quantity for ${item.produce}`}
                      >
                        +
                      </button>
                    </div>

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
          )}
        </section>

        <aside className={styles.summaryCard}>
          <h2>Order Summary</h2>
          <div className={styles.summaryLine}>
            <span>Items total</span>
            <strong>PHP {itemTotal.toFixed(2)}</strong>
          </div>
          <div className={styles.summaryLine}>
            <span>Service fee</span>
            <strong>PHP {serviceFee.toFixed(2)}</strong>
          </div>
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
