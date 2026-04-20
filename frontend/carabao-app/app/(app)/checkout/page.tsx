"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./page.module.css";

type CheckoutItem = {
  id: string;
  name: string;
  quantity: number;
  price: number;
};

const checkoutItems: CheckoutItem[] = [
  { id: "it-1", name: "Organic Eggplant", quantity: 3, price: 85 },
  { id: "it-2", name: "Heirloom Tomato", quantity: 2, price: 120 },
  { id: "it-3", name: "Fresh Okra", quantity: 1, price: 70 },
];

export default function CheckoutPage() {
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("08:00-10:00");
  const [paymentMethod, setPaymentMethod] = useState("cash-on-delivery");
  const [notes, setNotes] = useState("");

  const subtotal = useMemo(
    () =>
      checkoutItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
    [],
  );
  const serviceFee = 40;
  const grandTotal = subtotal + serviceFee;

  const orderId = `CB-${new Date().getFullYear()}-2219`;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Checkout</h1>
        <p>Confirm your delivery details and payment method.</p>
      </header>

      <div className={styles.layout}>
        <section className={styles.formCard}>
          <div className={styles.block}>
            <h2>Delivery Information</h2>
            <div className={styles.gridTwo}>
              <label>
                Delivery date
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(event) => setDeliveryDate(event.target.value)}
                />
              </label>
              <label>
                Time window
                <select
                  value={deliveryTime}
                  onChange={(event) => setDeliveryTime(event.target.value)}
                >
                  <option value="08:00-10:00">08:00 - 10:00</option>
                  <option value="10:00-12:00">10:00 - 12:00</option>
                  <option value="13:00-15:00">13:00 - 15:00</option>
                  <option value="16:00-18:00">16:00 - 18:00</option>
                </select>
              </label>
            </div>

            <label>
              Delivery address
              <textarea
                rows={3}
                defaultValue="Brgy. Poblacion, Science City of Munoz, Nueva Ecija"
              />
            </label>
          </div>

          <div className={styles.block}>
            <h2>Payment Method</h2>
            <div className={styles.paymentChoices}>
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="payment"
                  value="cash-on-delivery"
                  checked={paymentMethod === "cash-on-delivery"}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                />
                Cash on Delivery
              </label>
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="payment"
                  value="gcash"
                  checked={paymentMethod === "gcash"}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                />
                GCash
              </label>
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="payment"
                  value="bank-transfer"
                  checked={paymentMethod === "bank-transfer"}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                />
                Bank Transfer
              </label>
            </div>
          </div>

          <div className={styles.block}>
            <h2>Order Notes</h2>
            <label>
              Notes for merchant or rider
              <textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Include gate instructions, preferred contact method, or handling requests."
              />
            </label>
          </div>
        </section>

        <aside className={styles.summaryCard}>
          <h2>Order Summary</h2>
          <ul className={styles.itemList}>
            {checkoutItems.map((item) => (
              <li key={item.id}>
                <span>
                  {item.quantity} x {item.name}
                </span>
                <strong>PHP {(item.quantity * item.price).toFixed(2)}</strong>
              </li>
            ))}
          </ul>

          <div className={styles.totals}>
            <p>
              <span>Subtotal</span>
              <strong>PHP {subtotal.toFixed(2)}</strong>
            </p>
            <p>
              <span>Service fee</span>
              <strong>PHP {serviceFee.toFixed(2)}</strong>
            </p>
            <p className={styles.grandTotal}>
              <span>Total</span>
              <strong>PHP {grandTotal.toFixed(2)}</strong>
            </p>
          </div>

          <Link
            href={`/confirmation?orderId=${orderId}`}
            className={styles.primaryButton}
          >
            Place Order
          </Link>
          <Link href="/cart" className={styles.secondaryButton}>
            Back to Cart
          </Link>
        </aside>
      </div>
    </div>
  );
}
