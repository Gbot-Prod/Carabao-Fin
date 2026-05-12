"use client";

import { useEffect, useState } from "react";
import { fetchAdminMerchantApplications, type MerchantApplication } from "@/util/api/admin";
import styles from "./page.module.css";

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function ApplicationCard({ app }: { app: MerchantApplication }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.card}>
      <button className={styles.cardHeader} onClick={() => setOpen((v) => !v)}>
        <div className={styles.cardMeta}>
          <span className={styles.cardName}>{app.merchant_name}</span>
          <span className={styles.cardSub}>{app.legal_business_name} · {app.city}, {app.province}</span>
        </div>
        <div className={styles.cardRight}>
          <span className={`${styles.badge} ${styles[`badge_${app.status}`]}`}>
            {STATUS_LABELS[app.status] ?? app.status}
          </span>
          <span className={styles.chevron}>{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className={styles.cardBody}>
          <div className={styles.grid}>
            <Field label="Business Type" value={app.business_type} />
            <Field label="Contact Email" value={app.contact_email} />
            <Field label="Contact Number" value={app.contact_number} />
            <Field label="TIN" value={app.tin} />
            <Field label="Registration Type" value={app.registration_type} />
            <Field label="Registration No." value={app.registration_number} />
            <Field label="Address" value={app.address_line} />
            <Field label="Region" value={app.region} />
            <Field label="Postal Code" value={app.postal_code} />
            <Field label="Price Range" value={`₱${app.price_range_min} – ₱${app.price_range_max}`} />
            <Field label="Available Days" value={app.available_days.join(", ")} />
            <Field label="RSBSA No." value={app.rsbsa_number} />
            <Field label="Submitted" value={app.submitted_at ? new Date(app.submitted_at).toLocaleString("en-PH") : null} />
          </div>
          {app.rsbsa_document_path && (
            <a
              href={app.rsbsa_document_path}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.docLink}
            >
              View RSBSA Document
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value || <span className={styles.empty}>—</span>}</span>
    </div>
  );
}

export default function AdminReviewPage() {
  const [applications, setApplications] = useState<MerchantApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminMerchantApplications()
      .then(setApplications)
      .catch(() => setError("Failed to load applications."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.state}>Loading…</div>;
  if (error) return <div className={styles.stateError}>{error}</div>;

  const pending = applications.filter((a) => a.status === "submitted");
  const others = applications.filter((a) => a.status !== "submitted");

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>
        Application Review <span className={styles.count}>{pending.length} pending</span>
      </h1>

      {pending.length === 0 && others.length === 0 && (
        <p className={styles.empty}>No applications yet.</p>
      )}

      {pending.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Pending</h2>
          {pending.map((a) => <ApplicationCard key={a.id} app={a} />)}
        </section>
      )}

      {others.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Reviewed</h2>
          {others.map((a) => <ApplicationCard key={a.id} app={a} />)}
        </section>
      )}
    </div>
  );
}
