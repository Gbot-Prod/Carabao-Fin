"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { cancelPaymentCheckout, createPaymentCheckout, fetchMyCart, fetchMyProfile, placeOrderFromCart, type CartItem } from "@/util/api";
import { cartTotals, groupCartByMerchant } from "@/util/cartGroups";
import { clearPendingPayments, loadPendingPayments, savePendingPayments } from "@/util/pendingPayments";
import LocationSelects, { type LocationSelectsValue } from "@/components/LocationSelects/LocationSelects";
import { isLuzonRegion } from "@/util/serviceArea";
import { getApiErrorStatus } from "@/util/errorHelper";
import PageLoader from "@/components/PageLoader/PageLoader";

// Same windows the mobile app offers, so both clients store comparable values.
const TIME_WINDOWS = ["08:00 – 10:00", "10:00 – 12:00", "13:00 – 15:00", "16:00 – 18:00"];

// YYYY-MM-DD in the buyer's local calendar (en-CA formats as ISO).
const localIsoDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA");
};

export default function CheckoutPage() {
  const [checkoutItems, setCheckoutItems] = useState<CartItem[]>([]);
  const [isLoadingCart, setIsLoadingCart] = useState(true);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [street, setStreet] = useState("");
  const [postal, setPostal] = useState("");
  const [paymentMethod] = useState("online");
  const [notes, setNotes] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(() => localIsoDate(1));
  const [deliveryWindow, setDeliveryWindow] = useState(TIME_WINDOWS[0]);
  const [addressForm, setAddressForm] = useState<LocationSelectsValue>({
    region: "",
    province: "",
    city: "",
    barangay: "",
  });

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

    const loadProfile = async () => {
      try {
        const profile = await fetchMyProfile();
        if (profile.address) setStreet(profile.address);
        if (profile.postal_code) setPostal(profile.postal_code);
        setAddressForm({
          region: profile.region ?? "",
          province: profile.province ?? "",
          city: profile.city ?? "",
          barangay: profile.barangay ?? "",
        });
      } catch {
        // leave address blank if profile fetch fails
      }
    };

    void loadCart();
    void loadProfile();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = Number(params.get("order_id"));
    if (params.get("payment_cancelled") !== "1" || !Number.isInteger(orderId) || orderId <= 0) {
      return;
    }

    void cancelPaymentCheckout(orderId).catch((err) => {
      if (getApiErrorStatus(err) === 409) {
        setError("A payment for this order is still being processed. Check your orders before trying again.");
      }
      // Otherwise the server-side expiry sweep will still release stock.
    });
    // A multi-farm checkout (C1): release the other farms' unpaid orders too, so
    // the buyer can check out again from the cart without stock being held.
    const rest = loadPendingPayments().filter((o) => o.order_id !== orderId);
    clearPendingPayments();
    for (const other of rest) {
      void cancelPaymentCheckout(other.order_id).catch(() => {
        // The expiry sweep releases it anyway.
      });
    }
    setError("Payment was cancelled. Your items are available in your cart.");
    window.history.replaceState({}, "", "/checkout");
  }, []);

  // Checkout creates one order per farm (C1), each with its own delivery fee.
  const groups = useMemo(() => groupCartByMerchant(checkoutItems), [checkoutItems]);
  const { itemTotal: subtotal, deliveryTotal, grandTotal } = cartTotals(groups);

  const handlePlaceOrder = async () => {
    if (checkoutItems.length === 0 || isPlacingOrder) {
      return;
    }

    if (!street.trim() || !addressForm.city || !addressForm.barangay) {
      setError("Please enter your street address, city, and barangay before placing an order.");
      return;
    }

    if (!isLuzonRegion(addressForm.region)) {
      setError("Carabao currently delivers within Luzon only. Choose a Luzon region for your delivery address.");
      return;
    }

    if (!deliveryDate || deliveryDate < localIsoDate()) {
      setError("Please choose a delivery date from today onward.");
      return;
    }

    setIsPlacingOrder(true);
    setError(null);

    try {
      const deliveryAddress = [street, addressForm.barangay, addressForm.city, addressForm.province, postal, 'Philippines'].filter(Boolean).join(', ') || null;
      const result = await placeOrderFromCart({
        delivery_date: deliveryDate,
        delivery_time: deliveryWindow,
        delivery_address: deliveryAddress,
        delivery_region: addressForm.region,
        payment_method: paymentMethod,
        notes: notes || null,
        // Ignored by the server, which charges each merchant's own delivery fee.
        service_fee: deliveryTotal,
      });

      // PayMongo takes one order per checkout, so a multi-farm cart is paid in
      // turn: pay the first now, the success page offers the rest.
      const placed = result.orders?.length ? result.orders : null;
      if (placed && placed.length > 1) savePendingPayments(placed.slice(1));
      else clearPendingPayments();
      const checkout = await createPaymentCheckout(placed ? placed[0].order_id : result.order_id);
      window.location.href = checkout.checkout_url;
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
        <p>Confirm your delivery details before paying.</p>
      </header>

      <div className={styles.layout}>
        <section className={styles.formCard}>
          <div className={styles.block}>
            <h2>Delivery Information</h2>
            <label>
              Street / House No.
              <input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="123 Rizal Ave, Unit 4B"
              />
            </label>

            <div className={styles.locationGrid}>
              <LocationSelects
                value={addressForm}
                onChange={(location) => setAddressForm(previous => ({ ...previous, ...location }))}
                selectClassName={styles.locationSelect}
                labelClassName={styles.locationLabel}
                wrapClassName={styles.locationField}
              />
            </div>

            <label>
              Postal code
              <input
                type="text"
                value={postal}
                onChange={(e) => setPostal(e.target.value)}
                placeholder="1634"
              />
            </label>
          </div>

          <div className={styles.block}>
            <h2>Delivery Schedule</h2>
            <div className={styles.gridTwo}>
              <label>
                Preferred date
                <input
                  type="date"
                  value={deliveryDate}
                  min={localIsoDate()}
                  onChange={(event) => setDeliveryDate(event.target.value)}
                  required
                />
              </label>
              <label>
                Time window
                <select value={deliveryWindow} onChange={(event) => setDeliveryWindow(event.target.value)}>
                  {TIME_WINDOWS.map((slot) => (
                    <option key={slot} value={slot}>{slot}</option>
                  ))}
                </select>
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
                maxLength={500}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Include gate instructions, preferred contact method, or handling requests."
              />
            </label>
          </div>
        </section>

        <aside className={styles.summaryCard}>
          <h2>Order Summary</h2>
          {isLoadingCart ? (
            <PageLoader variant="compact" label="Loading cart items…" />
          ) : checkoutItems.length === 0 ? (
            <p>Your cart is empty. Add items before checkout.</p>
          ) : (
            groups.map((group) => (
              <div key={group.key} className={styles.farmGroup}>
                {groups.length > 1 && <h3 className={styles.farmGroupName}>{group.farm}</h3>}
                <ul className={styles.itemList}>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <span>
                        {item.quantity} x {item.produce}
                      </span>
                      <strong>PHP {(item.quantity * item.price).toFixed(2)}</strong>
                    </li>
                  ))}
                  <li className={styles.farmGroupFee}>
                    <span>Delivery{groups.length > 1 ? ` from ${group.farm}` : ""}</span>
                    <strong>PHP {group.deliveryFee.toFixed(2)}</strong>
                  </li>
                </ul>
              </div>
            ))
          )}

          <div className={styles.totals}>
            <p>
              <span>Subtotal</span>
              <strong>PHP {subtotal.toFixed(2)}</strong>
            </p>
            <p>
              <span>Delivery fees{groups.length > 1 ? ` (${groups.length} farms)` : ""}</span>
              <strong>PHP {deliveryTotal.toFixed(2)}</strong>
            </p>
            <p className={styles.grandTotal}>
              <span>Total</span>
              <strong>PHP {grandTotal.toFixed(2)}</strong>
            </p>
          </div>

          {groups.length > 1 && (
            <p className={styles.multiFarmNote}>
              This creates {groups.length} orders, one per farm. You&apos;ll pay for each in turn.
            </p>
          )}

          {error && <p className={styles.errorMessage}>{error}</p>}

          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handlePlaceOrder()}
            disabled={checkoutItems.length === 0 || isLoadingCart || isPlacingOrder}
          >
            {isPlacingOrder ? "Redirecting to payment..." : "Place Order"}
          </button>
          <Link href="/cart" className={styles.secondaryButton}>
            Back to Cart
          </Link>
        </aside>
      </div>
    </div>
  );
}
