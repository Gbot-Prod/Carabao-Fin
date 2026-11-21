"use client";

import Link from "next/link";
import { merchantUrl } from "@/lib/urls";
import { useMerchant } from "../MerchantContext";
import { currentStep } from "../lib/verification";
import styles from "./SetupChecklist.module.css";

/** Across Merchant Centre pages while Carabao has not verified the shop. */
export default function VerificationBanner() {
  const { status, verificationStatus } = useMerchant();
  if (status !== "ready" || !verificationStatus || verificationStatus === "verified") return null;
  const step = currentStep(verificationStatus);
  return (
    <div className={styles.banner} role="status">
      <p className={styles.bannerText}>
        <span className={styles.bannerTitle}>Your shop isn&apos;t live yet.</span>
        {step.text}
      </p>
      {step.action && (
        <Link href={merchantUrl(step.action.path)} className={styles.bannerAction}>
          {step.action.label}
        </Link>
      )}
    </div>
  );
}
