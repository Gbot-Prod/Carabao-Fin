"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { createPaymentCheckout, fetchMyCart, placeOrderFromCart, type CartItem } from "@/util/api";

export default function CheckoutPage() {
  const router = useRouter();
  const [checkoutItems, setCheckoutItems] = useState<CartItem[]>([]);
  const [isLoadingCart, setIsLoadingCart] = useState(true);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("08:00-10:00");
  const [paymentMethod, setPaymentMethod] = useState("cash-on-delivery");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const loadCart = async () => {
      try {
        const cart = await fetchMyCart();
        setCheckoutItems(Array.isArray(cart.items) ? cart.items : []);
      } catch {
        setCheckoutItems([]);
      } finally {
        setIsLoadingCart(false);
      }
    };

    void loadCart();
  }, []);

  const subtotal = useMemo(
    () =>
      checkoutItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
    [checkoutItems],
  );
  const serviceFee = 40;
  const grandTotal = subtotal + serviceFee;

  const handlePlaceOrder = async () => {
    if (checkoutItems.length === 0 || isPlacingOrder) {
      return;
    }

    setIsPlacingOrder(true);
    setError(null);

    try {
      const result = await placeOrderFromCart({
        delivery_date: deliveryDate || null,
        delivery_time: deliveryTime,
        payment_method: paymentMethod,
        notes: notes || null,
        service_fee: serviceFee,
      });

      if (paymentMethod === "online") {
        const checkout = await createPaymentCheckout(result.order_id);
        window.location.href = checkout.checkout_url;
      } else {
        router.push(`/confirmation?orderId=${encodeURIComponent(result.order_reference)}`);
      }
    } catch (err) {
      let message = "Unable to place order right now. Please try again.";

      if (axios.isAxiosError(err)) {
        const data = err.response?.data as unknown;
        const detail = (data as { detail?: unknown } | undefined)?.detail;
        if (typeof detail === "string" && detail.trim()) {
          message = detail;
        } else if (typeof err.message === "string" && err.message.trim()) {
          message = err.message;
        }
      }

      setError(message);
    } finally {
      setIsPlacingOrder(false);
    }
  };

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
                  value="online"
                  checked={paymentMethod === "online"}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                />
                <span>
                  Online Payment
                  <small style={{ display: "block", fontWeight: 400, color: "#666" }}>
                    GCash, Maya, Cards, GrabPay, and more
                  </small>
                </span>
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
          {isLoadingCart ? (
            <p>Loading cart items...</p>
          ) : checkoutItems.length === 0 ? (
            <p>Your cart is empty. Add items before checkout.</p>
          ) : (
            <ul className={styles.itemList}>
              {checkoutItems.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.quantity} x {item.produce}
                  </span>
                  <strong>PHP {(item.quantity * item.price).toFixed(2)}</strong>
                </li>
              ))}
            </ul>
          )}

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

          {error && <p className={styles.errorMessage}>{error}</p>}

          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handlePlaceOrder()}
            disabled={checkoutItems.length === 0 || isLoadingCart || isPlacingOrder}
          >
            {isPlacingOrder
              ? paymentMethod === "online"
                ? "Redirecting to payment..."
                : "Placing Order..."
              : "Place Order"}
          </button>
          <Link href="/cart" className={styles.secondaryButton}>
            Back to Cart
          </Link>
        </aside>
      </div>
    </div>
  );
}
