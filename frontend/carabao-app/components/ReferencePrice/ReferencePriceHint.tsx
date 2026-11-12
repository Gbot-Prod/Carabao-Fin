"use client";

import { useEffect, useState } from "react";
import { fetchReferencePrices, matchReferencePrice, type ReferencePrice } from "@/util/api/referencePrices";
import styles from "./ReferencePriceHint.module.css";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";

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
  const { t } = useLanguage();
  const ref = matchReferencePrice(prices ?? loaded, name, unit);
  if (!ref) return null;

  const range = `₱${ref.low.toLocaleString()}–₱${ref.high.toLocaleString()} / ${ref.unit}`;
  const sameUnit = !unit || unit === ref.unit;
  let comparison: string | null = null;
  if (variant === "form" && price && price > 0 && sameUnit) {
    if (price > ref.high) comparison = t.reference.above;
    else if (price < ref.low) comparison = t.reference.below;
    else comparison = t.reference.within;
  }

  return (
    <div className={`${styles.hint} ${variant === "card" ? styles.card : ""}`} role="note">
      <span className={styles.label}>
        {variant === "form" ? fmt(t.reference.marketReferenceFor, { commodity: ref.commodity }) : t.reference.marketReference}:
      </span>{" "}
      <strong className={styles.range}>{range}</strong>
      {ref.is_sample && <span className={styles.sample}>{t.reference.sampleData}</span>}
      {variant === "form" && (
        <span className={styles.source}>
          {ref.source} · {fmt(t.reference.asOf, { date: asOf(ref.as_of) })}
          {!sameUnit && ` · ${fmt(t.reference.listedPer, { refUnit: ref.unit, unit: unit ?? "" })}`}
        </span>
      )}
      {comparison && <span className={styles.comparison}>{comparison}</span>}
    </div>
  );
}
