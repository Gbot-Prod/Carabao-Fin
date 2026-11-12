"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { cancelPaymentCheckout, createPaymentCheckout, fetchMyCart, fetchMyProfile, placeOrderFromCart, type CartItem } from "@/util/api";
import { cartTotals, groupCartByMerchant } from "@/util/cartGroups";
import { clearPendingPayments, loadPendingPayments, savePendingPayments } from "@/util/pendingPayments";
import LocationSelects, { type LocationSelectsValue } from "@/components/LocationSelects/LocationSelects";
import MapPinPicker from "@/components/MapPinPicker/MapPinPicker";
import type { Pin } from "@/util/reverseGeocode";
import { isLuzonRegion } from "@/util/serviceArea";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
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
  const { t } = useLanguage();
  const [checkoutItems, setCheckoutItems] = useState<CartItem[]>([]);
  const [isLoadingCart, setIsLoadingCart] = useState(true);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set by the mount-only payment-return effect; translated at render time so it
  // follows the language toggle without re-running that effect.
  const [returnNotice, setReturnNotice] = useState<"errPaymentProcessing" | "errPaymentCancelled" | null>(null);
  const [street, setStreet] = useState("");
  const [postal, setPostal] = useState("");
  const [paymentMethod] = useState("online");
  const [notes, setNotes] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(() => localIsoDate(1));
  const [deliveryWindow, setDeliveryWindow] = useState(TIME_WINDOWS[0]);
  // Delivery pin (U1b): starts at the profile's saved pin, if any.
  const [pin, setPin] = useState<Pin | null>(null);
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
        if (profile.lat != null && profile.lng != null) setPin({ lat: profile.lat, lng: profile.lng });
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
        setReturnNotice("errPaymentProcessing");
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
    setReturnNotice("errPaymentCancelled");
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
      setError(t.checkout.errAddressMissing);
      return;
    }

    if (!isLuzonRegion(addressForm.region)) {
      setError(t.checkout.errOutsideLuzon);
      return;
    }

    if (!deliveryDate || deliveryDate < localIsoDate()) {
      setError(t.checkout.errDate);
      return;
    }

    setIsPlacingOrder(true);
    setError(null);
    setReturnNotice(null);

    try {
      const deliveryAddress = [street, addressForm.barangay, addressForm.city, addressForm.province, postal, 'Philippines'].filter(Boolean).join(', ') || null;
      const result = await placeOrderFromCart({
        delivery_date: deliveryDate,
        delivery_time: deliveryWindow,
        delivery_address: deliveryAddress,
        delivery_region: addressForm.region,
        delivery_lat: pin?.lat ?? null,
        delivery_lng: pin?.lng ?? null,
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
      let message = t.checkout.errGeneric;

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
        <h1>{t.checkout.title}</h1>
        <p>{t.checkout.subtitle}</p>
      </header>

      <div className={styles.layout}>
        <section className={styles.formCard}>
          <div className={styles.block}>
            <h2>{t.checkout.deliveryInfo}</h2>
            <label>
              {t.checkout.street}
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
              {t.checkout.postal}
              <input
                type="text"
                value={postal}
                onChange={(e) => setPostal(e.target.value)}
                placeholder="1634"
              />
            </label>

            <MapPinPicker
              value={pin}
              onChange={(next, found) => {
                setPin(next);
                if (!street.trim() && found?.street) setStreet(found.street);
                if (!postal.trim() && found?.postcode) setPostal(found.postcode);
              }}
            />
          </div>

          <div className={styles.block}>
            <h2>{t.checkout.schedule}</h2>
            <div className={styles.gridTwo}>
              <label>
                {t.checkout.preferredDate}
                <input
                  type="date"
                  value={deliveryDate}
                  min={localIsoDate()}
                  onChange={(event) => setDeliveryDate(event.target.value)}
                  required
                />
              </label>
              <label>
                {t.checkout.timeWindow}
                <select value={deliveryWindow} onChange={(event) => setDeliveryWindow(event.target.value)}>
                  {TIME_WINDOWS.map((slot) => (
                    <option key={slot} value={slot}>{slot}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className={styles.block}>
            <h2>{t.checkout.notesTitle}</h2>
            <label>
              {t.checkout.notesLabel}
              <textarea
                rows={3}
                value={notes}
                maxLength={500}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t.checkout.notesPlaceholder}
              />
            </label>
          </div>
        </section>

        <aside className={styles.summaryCard}>
          <h2>{t.checkout.summary}</h2>
          {isLoadingCart ? (
            <PageLoader variant="compact" label={t.checkout.loading} />
          ) : checkoutItems.length === 0 ? (
            <p>{t.checkout.empty}</p>
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
                    <span>{groups.length > 1 ? fmt(t.checkout.deliveryFrom, { farm: group.farm }) : t.checkout.deliveryFee}</span>
                    <strong>PHP {group.deliveryFee.toFixed(2)}</strong>
                  </li>
                </ul>
              </div>
            ))
          )}

          <div className={styles.totals}>
            <p>
              <span>{t.checkout.subtotal}</span>
              <strong>PHP {subtotal.toFixed(2)}</strong>
            </p>
            <p>
              <span>{groups.length > 1 ? fmt(t.checkout.deliveryFeesFarms, { count: groups.length }) : t.checkout.deliveryFees}</span>
              <strong>PHP {deliveryTotal.toFixed(2)}</strong>
            </p>
            <p className={styles.grandTotal}>
              <span>{t.checkout.total}</span>
              <strong>PHP {grandTotal.toFixed(2)}</strong>
            </p>
          </div>

          {groups.length > 1 && (
            <p className={styles.multiFarmNote}>{fmt(t.checkout.multiFarmNote, { count: groups.length })}</p>
          )}

          {(error ?? returnNotice) && (
            <p className={styles.errorMessage}>{error ?? (returnNotice ? t.checkout[returnNotice] : null)}</p>
          )}

          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handlePlaceOrder()}
            disabled={checkoutItems.length === 0 || isLoadingCart || isPlacingOrder}
          >
            {isPlacingOrder ? t.checkout.redirecting : t.checkout.placeOrder}
          </button>
          <Link href="/cart" className={styles.secondaryButton}>
            {t.checkout.backToCart}
          </Link>
        </aside>
      </div>
    </div>
  );
}
