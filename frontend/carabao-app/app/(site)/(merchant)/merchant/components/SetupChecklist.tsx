"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Circle } from "lucide-react";
import { MERCHANT_PAGES as P } from "@/lib/merchant-links";
import { merchantUrl } from "@/lib/urls";
import { fetchMyPayoutInfo } from "@/util/api";
import { useReadyMerchant } from "../MerchantContext";
import { APPROVED_PUBLISH, BUSINESS_STEP_PATH, PUBLISH_LOCKED } from "../lib/verification";
import styles from "./SetupChecklist.module.css";

type Item = {
  key: string;
  label: string;
  done: boolean;
  /** Where the step is done; none for a step the merchant cannot do yet. */
  path?: string;
  detail?: string;
  note?: string | null;
};

/**
 * Dashboard home: the steps to a live shop, shown until the shop is published.
 * The Merchant Centre works before approval; selling waits for it.
 */
export default function SetupChecklist() {
  const { performance, shopPage, productCount, application } = useReadyMerchant();
  const status = performance.verification_status;
  // undefined while loading; null when no payout account is set up.
  const [hasPayout, setHasPayout] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let live = true;
    fetchMyPayoutInfo()
      .then((info) => live && setHasPayout(info != null))
      .catch(() => live && setHasPayout(false));
    return () => {
      live = false;
    };
  }, []);

  if (shopPage?.is_published) return null;

  const verified = status === "verified";
  const submitted = status === "under_review" || verified || status === "suspended";
  const approval: Item = {
    key: "approved",
    label: "Approved by Carabao",
    done: verified,
    detail:
      status === "under_review"
        ? "Under review"
        : status === "needs_changes"
          ? "Changes requested"
          : status === "suspended"
            ? "Suspended. Contact Carabao support."
            : verified
              ? undefined
              : "After you submit your business documents",
    note: status === "needs_changes" ? application?.admin_note : null,
  };

  const items: Item[] = [
    { key: "contact", label: "Contact details verified", done: true },
    {
      key: "shop",
      label: "Shop page drafted",
      detail: "Title and logo set",
      done: Boolean(shopPage?.draft_title?.trim() && shopPage?.draft_logo_url),
      path: P.shop,
    },
    { key: "product", label: "At least one product added", done: productCount > 0, path: P.produce },
    {
      key: "payout",
      label: "Payout account added",
      done: hasPayout === true,
      path: P.earnings,
    },
    {
      key: "documents",
      label: "Business documents submitted",
      done: submitted,
      detail: status === "needs_changes" ? "Update them and submit again" : undefined,
      path: submitted ? undefined : BUSINESS_STEP_PATH,
    },
    approval,
    {
      key: "publish",
      label: "Publish your shop",
      done: false,
      detail: verified ? APPROVED_PUBLISH : PUBLISH_LOCKED,
      path: verified ? P.shop : undefined,
    },
  ];
  const doneCount = items.filter((i) => i.done).length;

  return (
    <section className={styles.card} aria-labelledby="setup-checklist-title">
      <div className={styles.head}>
        <div>
          <h2 id="setup-checklist-title" className={styles.title}>
            Get your shop live
          </h2>
          <p className={styles.sub}>
            {verified ? APPROVED_PUBLISH : "You can set everything up now. Buyers see your shop once Carabao approves it and you publish."}
          </p>
        </div>
        <span className={styles.progress} aria-label={`${doneCount} of ${items.length} steps done`}>
          {doneCount}/{items.length}
        </span>
      </div>
      <ol className={styles.list}>
        {items.map((item) => {
          const body = (
            <>
              <span className={`${styles.mark} ${item.done ? styles.markDone : ""}`} aria-hidden="true">
                {item.done ? <Check size={14} strokeWidth={2.5} /> : <Circle size={14} strokeWidth={2} />}
              </span>
              <span className={styles.text}>
                <span className={styles.label}>
                  {item.label}
                  <span className={styles.srOnly}>{item.done ? " (done)" : " (to do)"}</span>
                </span>
                {item.detail && <span className={styles.detail}>{item.detail}</span>}
                {item.note && <span className={styles.note}>Carabao: {item.note}</span>}
              </span>
              {item.path && !item.done && <ChevronRight size={16} className={styles.chevron} aria-hidden="true" />}
            </>
          );
          return (
            <li key={item.key}>
              {item.path && !item.done ? (
                <Link href={merchantUrl(item.path)} className={`${styles.row} ${styles.rowLink}`}>
                  {body}
                </Link>
              ) : (
                <div className={styles.row}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
