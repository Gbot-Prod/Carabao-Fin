"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { cancelPaymentCheckout, createPaymentCheckout, defaultAddress, fetchMyAddresses, fetchMyCart, placeOrderFromCart, previewVoucher, type CartItem, type UserAddress, type VoucherPreview } from "@/util/api";
import { cartTotals, groupCartByMerchant } from "@/util/cartGroups";
import { clearPendingPayments, loadPendingPayments, savePendingPayments } from "@/util/pendingPayments";
import LocationSelects, { type LocationSelectsValue } from "@/components/LocationSelects/LocationSelects";
import MapPinPicker from "@/components/MapPinPicker/MapPinPicker";
import type { Pin } from "@/util/geocode";
import { focusFirstInvalid } from "@/components/FieldError/FieldError";
import { isLuzonRegion } from "@/util/serviceArea";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
import getApiErrorMessage, { getApiErrorStatus, isPhoneVerificationRequired } from "@/util/errorHelper";
import { normalizeBuyerCode } from "@/lib/vouchers";
import PhoneVerifyDialog from "@/components/PhoneVerifyDialog/PhoneVerifyDialog";
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
  // The account has no verified mobile number yet (e.g. a Google sign-in):
  // verify one, then place the order again.
  const [needsPhone, setNeedsPhone] = useState(false);
  // Set by the mount-only payment-return effect; translated at render time so it
  // follows the language toggle without re-running that effect.
  const [returnNotice, setReturnNotice] = useState<"errPaymentProcessing" | "errPaymentCancelled" | null>(null);
  const [street, setStreet] = useState("");
  const [postal, setPostal] = useState("");
  const [notes, setNotes] = useState("");
  const [voucherInput, setVoucherInput] = useState("");
  const [voucher, setVoucher] = useState<VoucherPreview | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [checkingVoucher, setCheckingVoucher] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(() => localIsoDate(1));
  const [deliveryWindow, setDeliveryWindow] = useState(TIME_WINDOWS[0]);
  // Delivery pin (U1b): starts at the saved address's pin, if any.
  const [pin, setPin] = useState<Pin | null>(null);
  // Whether the buyer placed the pin (false: only where the address geocoded to).
  const [pinConfirmed, setPinConfirmed] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  // Saved addresses; the default one pre-fills the form.
  const [savedAddresses, setSavedAddresses] = useState<UserAddress[]>([]);
  const [savedAddressId, setSavedAddressId] = useState<number | null>(null);
  const [addressForm, setAddressForm] = useState<LocationSelectsValue>({
    region: "",
    province: "",
    city: "",
    barangay: "",
  });

  const applySavedAddress = (a: UserAddress | null) => {
    setSavedAddressId(a?.id ?? null);
    setStreet(a?.address ?? "");
    setPostal(a?.postal_code ?? "");
    setPin(a?.lat != null && a?.lng != null ? { lat: a.lat, lng: a.lng } : null);
    setPinConfirmed(a?.pin_confirmed ?? false);
    setPinError(null);
    setAddressForm({
      region: a?.region ?? "",
      province: a?.province ?? "",
      city: a?.city ?? "",
      barangay: a?.barangay ?? "",
    });
  };

  // Lines ticked on the cart page (?items=1,2,3). Null means the whole cart.
  const [selectedIds, setSelectedIds] = useState<number[] | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("items");
    const ids = raw
      ? [...new Set(raw.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))]
      : [];
    const picked = ids.length > 0 ? ids : null;
    setSelectedIds(picked);

    const loadCart = async () => {
      try {
        const cart = await fetchMyCart();
        const all = Array.isArray(cart.items) ? cart.items : [];
        setCheckoutItems(picked ? all.filter((item) => picked.includes(Number(item.id))) : all);
      } catch {
        setCheckoutItems([]);
      } finally {
        setIsLoadingCart(false);
      }
    };

    const loadAddresses = async () => {
      try {
        const addresses = await fetchMyAddresses();
        setSavedAddresses(addresses);
        const initial = defaultAddress(addresses);
        if (initial) applySavedAddress(initial);
      } catch {
        // leave address blank if the fetch fails
      }
    };

    void loadCart();
    void loadAddresses();
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
  // CF-0064: an applied farm voucher. The server checks it again at place-order.
  const discount = voucher?.discount ?? 0;
  const payable = Math.max(grandTotal - discount, 0);

  const applyVoucher = async () => {
    const code = normalizeBuyerCode(voucherInput);
    if (!code) {
      setVoucherError(t.checkout.voucherBadCode);
      return;
    }
    setCheckingVoucher(true);
    setVoucherError(null);
    try {
      setVoucher(await previewVoucher(code));
    } catch (err) {
      setVoucher(null);
      setVoucherError(getApiErrorMessage(err) ?? t.checkout.voucherError);
    } finally {
      setCheckingVoucher(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (checkoutItems.length === 0 || isPlacingOrder) {
      return;
    }

    if (!street.trim() || !addressForm.city || !addressForm.barangay) {
      setError(t.checkout.errAddressMissing);
      return;
    }

    // Every delivery needs a pin; a suggested one counts only once confirmed or moved.
    if (!pin || !pinConfirmed) {
      setPinError(pin ? t.mapPin.confirmNeeded : t.mapPin.pinRequired);
      requestAnimationFrame(focusFirstInvalid);
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
        delivery_lat: pin && pinConfirmed ? pin.lat : null,
        delivery_lng: pin && pinConfirmed ? pin.lng : null,
        delivery_pin_confirmed: !!pin && pinConfirmed,
        notes: notes || null,
        voucher_code: voucher?.code ?? null,
        // Send exactly what this page shows, so unticked lines stay in the cart.
        ...(selectedIds ? { produce_ids: checkoutItems.map((item) => Number(item.id)) } : {}),
      });

      // PayMongo takes one order per checkout, so a multi-farm cart is paid in
      // turn: pay the first now, the success page offers the rest.
      const placed = result.orders?.length ? result.orders : null;
      if (placed && placed.length > 1) savePendingPayments(placed.slice(1));
      else clearPendingPayments();
      const checkout = await createPaymentCheckout(placed ? placed[0].order_id : result.order_id);
      window.location.href = checkout.checkout_url;
    } catch (err) {
      if (isPhoneVerificationRequired(err)) {
        setNeedsPhone(true);
        return;
      }
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
            {savedAddresses.length > 1 && (
              <label>
                {t.checkout.savedAddress}
                <select
                  value={savedAddressId ?? ""}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    applySavedAddress(savedAddresses.find((a) => a.id === id) ?? null);
                  }}
                >
                  {savedAddresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {[a.label, a.address, a.city].filter(Boolean).join(" · ") || `#${a.id}`}
                    </option>
                  ))}
                  <option value="">{t.checkout.newAddress}</option>
                </select>
              </label>
            )}
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

            <label>
              {t.checkout.street}
              <input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="123 Rizal Ave, Unit 4B"
              />
            </label>

            <MapPinPicker
              value={pin}
              confirmed={pinConfirmed}
              onChange={(next, confirmed) => {
                setPin(next);
                setPinConfirmed(confirmed);
                if (confirmed) setPinError(null);
              }}
              error={pinError}
              address={{ street, postalCode: postal, ...addressForm }}
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
                  max={localIsoDate(30)}
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

          {checkoutItems.length > 0 && (
            <div className={styles.voucherBlock}>
              {voucher ? (
                <p className={styles.voucherApplied}>
                  <span>
                    {fmt(t.checkout.voucherApplied, {
                      code: voucher.code,
                      amount: voucher.discount.toFixed(2),
                      farm: voucher.merchant_name,
                    })}
                  </span>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => {
                      setVoucher(null);
                      setVoucherInput("");
                    }}
                  >
                    {t.checkout.voucherRemove}
                  </button>
                </p>
              ) : (
                <form
                  className={styles.voucherForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void applyVoucher();
                  }}
                >
                  <label htmlFor="checkout-voucher">{t.checkout.voucherLabel}</label>
                  <div className={styles.voucherRow}>
                    <input
                      id="checkout-voucher"
                      value={voucherInput}
                      maxLength={32}
                      autoCapitalize="characters"
                      autoComplete="off"
                      onChange={(event) => {
                        setVoucherInput(event.target.value);
                        setVoucherError(null);
                      }}
                    />
                    <button type="submit" className={styles.secondaryButton} disabled={checkingVoucher || !voucherInput.trim()}>
                      {checkingVoucher ? t.checkout.voucherChecking : t.checkout.voucherApply}
                    </button>
                  </div>
                </form>
              )}
              {voucherError && (
                <p className={styles.errorMessage} role="alert">{voucherError}</p>
              )}
            </div>
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
            {voucher && discount > 0 && (
              <p>
                <span>{fmt(t.checkout.voucherDiscount, { code: voucher.code })}</span>
                <strong>−PHP {discount.toFixed(2)}</strong>
              </p>
            )}
            <p className={styles.grandTotal}>
              <span>{t.checkout.total}</span>
              <strong>PHP {payable.toFixed(2)}</strong>
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

      {needsPhone && (
        <PhoneVerifyDialog
          reason="Before your first order, verify a mobile number so the farm and rider can reach you."
          onClose={() => setNeedsPhone(false)}
          onVerified={() => {
            setNeedsPhone(false);
            void handlePlaceOrder();
          }}
        />
      )}
    </div>
  );
}
