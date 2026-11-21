"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { MERCHANT_PAGES as P } from "@/lib/merchant-links";
import { helpUrl, merchantUrl } from "@/lib/urls";
import MerchantTopBar from "./MerchantTopBar";
import styles from "./welcome.module.css";

/** An application form in a pale circle. Decorative only. */
function FormIllustration() {
  return (
    <svg className={styles.art} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <circle cx="100" cy="100" r="96" fill="#e3f2e8" />
      <circle cx="100" cy="100" r="70" fill="#d3ebdc" opacity="0.6" />
      {/* Small marks around the form */}
      <circle cx="40" cy="62" r="4" fill="#9fd3b2" />
      <circle cx="164" cy="140" r="5" fill="#9fd3b2" />
      <path d="M150 44l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#7cc99a" />
      {/* Back sheet */}
      <rect x="62" y="46" width="88" height="108" rx="8" fill="#ffffff" opacity="0.7" transform="rotate(6 106 100)" />
      {/* Form */}
      <rect x="54" y="50" width="88" height="108" rx="8" fill="#ffffff" />
      <rect x="54" y="50" width="88" height="22" rx="8" fill="#2f9e5f" />
      <rect x="54" y="64" width="88" height="8" fill="#2f9e5f" />
      <circle cx="68" cy="61" r="5" fill="#f4ead0" />
      <rect x="78" y="58" width="40" height="5" rx="2.5" fill="#cfe9d8" />
      <g fill="#dbe5de">
        <rect x="66" y="84" width="64" height="6" rx="3" />
        <rect x="66" y="98" width="50" height="6" rx="3" />
        <rect x="66" y="112" width="58" height="6" rx="3" />
        <rect x="66" y="126" width="38" height="6" rx="3" />
      </g>
      <rect x="66" y="140" width="30" height="9" rx="4.5" fill="#2f9e5f" />
      {/* Leaf badge */}
      <circle cx="142" cy="66" r="15" fill="#133520" />
      <path d="M135 72c0-9 6-14 15-14 0 10-5 14-13 14" fill="#5ccf8a" />
      {/* Pen */}
      <g transform="rotate(40 150 132)">
        <rect x="145" y="104" width="10" height="40" rx="2" fill="#f08a24" />
        <rect x="145" y="104" width="10" height="7" rx="2" fill="#a86f48" />
        <path d="M145 144h10l-5 10z" fill="#f4ead0" />
        <path d="M148.5 151h3l-1.5 3z" fill="#24352a" />
      </g>
    </svg>
  );
}

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.page}>
      <MerchantTopBar />
      <main className={styles.main}>
        <section className={styles.card} aria-labelledby="merchant-welcome-title">
          <FormIllustration />
          <h1 id="merchant-welcome-title" className={styles.title}>{title}</h1>
          <p className={styles.body}>{children}</p>
          {action}
        </section>
      </main>
    </div>
  );
}

const startLink = (label: string) => (
  <Link className={styles.button} href={merchantUrl(P.onboarding)}>{label}</Link>
);

/**
 * A signed-in user with no merchant profile. The text depends on their
 * merchant application (backend application_review.py): none yet, under
 * review, more information needed, not approved, or suspended.
 */
export default function MerchantWelcome({ applicationStatus }: { applicationStatus: string | null }) {
  switch (applicationStatus) {
    case "submitted":
      return (
        <Card title="Application under review">
          We are checking your merchant application. We will tell you by email and in your notifications when we
          approve it.
        </Card>
      );
    case "pending_documents":
      // Saved with "Submit later": nothing to review until it is sent.
      return (
        <Card title="Finish your business information to start selling" action={startLink("Finish business information")}>
          We saved your contact and operations details. Add your business, tax and document details to send your
          application for review.
        </Card>
      );
    case "clarification":
      return (
        <Card title="More information needed" action={startLink("Update application")}>
          We need more information about your application. Open the application, change the details and send it
          again.
        </Card>
      );
    case "rejected":
      return (
        <Card title="Application not approved" action={startLink("Apply again")}>
          We did not approve your merchant application. You can correct it and send it again.
        </Card>
      );
    case "suspended":
      return (
        <Card
          title="Merchant account suspended"
          action={<a className={styles.button} href={helpUrl("/contact")}>Contact support</a>}
        >
          This merchant account is suspended. Contact Carabao support for help.
        </Card>
      );
    default:
      // No application yet, or a closed merchant ("approved" with no profile).
      return (
        <Card title="Welcome to Carabao Merchant Centre!" action={startLink("Start Registration")}>
          To get started, register as a merchant. Tell us about your farm or business, and we will review your
          application.
        </Card>
      );
  }
}
