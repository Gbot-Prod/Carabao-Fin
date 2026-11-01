"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { cancelPaymentCheckout, createPaymentCheckout, fetchMyCart, fetchMyProfile, placeOrderFromCart, type CartItem } from "@/util/api";
import { SERVICE_FEE } from "@/lib/constants";
import LocationSelects, { type LocationSelectsValue } from "@/components/LocationSelects/LocationSelects";
import { getApiErrorStatus } from "@/util/errorHelper";
import PageLoader from "@/components/PageLoader/PageLoader";

export default function CheckoutPage() {
  const [checkoutItems, setCheckoutItems] = useState<CartItem[]>([]);
  const [isLoadingCart, setIsLoadingCart] = useState(true);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [street, setStreet] = useState("");
  const [postal, setPostal] = useState("");
  const [paymentMethod] = useState("online");
  const [notes, setNotes] = useState("");
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
    setError("Payment was cancelled. Your items are available in your cart.");
    window.history.replaceState({}, "", "/checkout");
  }, []);

  const subtotal = useMemo(
    () =>
      checkoutItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
    [checkoutItems],
  );
  const serviceFee = SERVICE_FEE;
  const grandTotal = subtotal + serviceFee;

  const handlePlaceOrder = async () => {
    if (checkoutItems.length === 0 || isPlacingOrder) {
      return;
    }

    if (!street.trim() || !addressForm.city || !addressForm.barangay) {
      setError("Please enter your street address, city, and barangay before placing an order.");
      return;
    }

    setIsPlacingOrder(true);
    setError(null);

    try {
      const deliveryAddress = [street, addressForm.barangay, addressForm.city, addressForm.province, postal, 'Philippines'].filter(Boolean).join(', ') || null;
      const result = await placeOrderFromCart({
        delivery_date: null,
        delivery_time: null,
        delivery_address: deliveryAddress,
        payment_method: paymentMethod,
        notes: notes || null,
        service_fee: serviceFee,
      });

      const checkout = await createPaymentCheckout(result.order_id);
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
            <PageLoader variant="compact" label="Loading cart items…" />
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
