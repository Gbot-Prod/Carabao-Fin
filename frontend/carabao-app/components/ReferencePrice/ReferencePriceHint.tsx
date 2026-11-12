"use client";

import { useEffect, useState } from "react";
import { fetchReferencePrices, matchReferencePrice, type ReferencePrice } from "@/util/api/referencePrices";
import styles from "./ReferencePriceHint.module.css";

const asOf = (iso: string) =>
  new Date(`${iso}T00:00:00+08:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

/** Loads the reference list once and keeps it in component state. */
export function useReferencePrices(): ReferencePrice[] {
  const [prices, setPrices] = useState<ReferencePrice[]>([]);
  useEffect(() => {
    let active = true;
    fetchReferencePrices()
      .then((rows) => { if (active) setPrices(rows); })
      .catch(() => { /* the hint is optional; show nothing */ });
    return () => { active = false; };
  }, []);
  return prices;
}

type Props = {
  name: string | null | undefined;
  unit?: string | null;
  /** The merchant's price per unit; compared with the range when given. */
  price?: number;
  /** "form" adds the comparison note; "card" is the compact buyer view. */
  variant?: "form" | "card";
  prices?: ReferencePrice[];
};

/**
 * The market reference range for a listing (P1). Information only: it never
 * sets or caps a price. Sample rows are always labelled as samples.
 */
export default function ReferencePriceHint({ name, unit, price, variant = "form", prices }: Props) {
  const loaded = useReferencePrices();
  const ref = matchReferencePrice(prices ?? loaded, name, unit);
  if (!ref) return null;

  const range = `₱${ref.low.toLocaleString()}–₱${ref.high.toLocaleString()} / ${ref.unit}`;
  const sameUnit = !unit || unit === ref.unit;
  let comparison: string | null = null;
  if (variant === "form" && price && price > 0 && sameUnit) {
    if (price > ref.high) comparison = "Your price is above this range.";
    else if (price < ref.low) comparison = "Your price is below this range.";
    else comparison = "Your price is within this range.";
  }

  return (
    <div className={`${styles.hint} ${variant === "card" ? styles.card : ""}`} role="note">
      <span className={styles.label}>Market reference{variant === "form" ? ` for ${ref.commodity}` : ""}:</span>{" "}
      <strong className={styles.range}>{range}</strong>
      {ref.is_sample && <span className={styles.sample}>Sample data</span>}
      {variant === "form" && (
        <span className={styles.source}>
          {ref.source} · as of {asOf(ref.as_of)}
          {!sameUnit && ` · listed per ${ref.unit}, not ${unit}`}
        </span>
      )}
      {comparison && <span className={styles.comparison}>{comparison}</span>}
    </div>
  );
}
