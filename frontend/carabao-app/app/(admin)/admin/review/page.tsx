"use client";

import { useEffect, useState } from "react";
import {
  fetchAdminMerchantApplications,
  reviewMerchantApplication,
  type MerchantApplication,
} from "@/util/api/admin";
import styles from "./page.module.css";

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  clarification: "Needs Clarification",
};

type ReviewAction = "approved" | "rejected" | "clarification";

function ApplicationCard({
  app,
  onUpdate,
}: {
  app: MerchantApplication;
  onUpdate: (updated: MerchantApplication) => void;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectAction = (a: ReviewAction) => {
    setAction((prev) => (prev === a ? null : a));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!action) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await reviewMerchantApplication(
        app.id,
        action,
        action === "clarification" ? note.trim() : undefined,
      );
      onUpdate(updated);
      setAction(null);
      setNote("");
    } catch {
      setError("Failed to update application. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmLabel =
    action === "approved"
      ? "Confirm Approval"
      : action === "rejected"
      ? "Confirm Rejection"
      : "Send Clarification Request";

  return (
    <div className={styles.card}>
      <button className={styles.cardHeader} onClick={() => setOpen((v) => !v)}>
        <div className={styles.cardMeta}>
          <span className={styles.cardName}>{app.merchant_name}</span>
          <span className={styles.cardSub}>
            {app.legal_business_name} · {app.city}, {app.province}
          </span>
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
            <Field label="City / Province" value={`${app.city}, ${app.province}`} />
            <Field label="Region" value={app.region} />
            <Field label="Postal Code" value={app.postal_code} />
            <Field
              label="Price Range"
              value={`₱${app.price_range_min} – ₱${app.price_range_max}`}
            />
            <Field label="Available Days" value={app.available_days.join(", ")} />
            <Field label="RSBSA No." value={app.rsbsa_number} />
            <Field
              label="Submitted"
              value={
                app.submitted_at
                  ? new Date(app.submitted_at).toLocaleString("en-PH")
                  : null
              }
            />
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

          {app.admin_note && (
            <div className={styles.adminNote}>
              <span className={styles.adminNoteLabel}>Admin Note</span>
              <p className={styles.adminNoteText}>{app.admin_note}</p>
            </div>
          )}

          <div className={styles.actionPanel}>
            <span className={styles.actionLabel}>Review Decision</span>
            <div className={styles.actionButtons}>
              <button
                className={`${styles.actionBtn} ${styles.actionBtnApprove} ${action === "approved" ? styles.actionBtnSelected : ""}`}
                onClick={() => selectAction("approved")}
              >
                Accept
              </button>
              <button
                className={`${styles.actionBtn} ${styles.actionBtnReject} ${action === "rejected" ? styles.actionBtnSelected : ""}`}
                onClick={() => selectAction("rejected")}
              >
                Reject
              </button>
              <button
                className={`${styles.actionBtn} ${styles.actionBtnClarify} ${action === "clarification" ? styles.actionBtnSelected : ""}`}
                onClick={() => selectAction("clarification")}
              >
                Request Clarification
              </button>
            </div>

            {action === "clarification" && (
              <textarea
                className={styles.noteInput}
                placeholder="Describe what additional information or corrections are needed from the applicant…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
            )}

            {action && (
              <div className={styles.actionConfirm}>
                {error && <span className={styles.actionError}>{error}</span>}
                <button
                  className={styles.submitBtn}
                  disabled={
                    submitting ||
                    (action === "clarification" && !note.trim())
                  }
                  onClick={handleSubmit}
                >
                  {submitting ? "Saving…" : confirmLabel}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>
        {value || <span className={styles.emptyVal}>—</span>}
      </span>
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

  const handleUpdate = (updated: MerchantApplication) => {
    setApplications((prev) =>
      prev.map((a) => (a.id === updated.id ? updated : a)),
    );
  };

  if (loading) return <div className={styles.state}>Loading…</div>;
  if (error) return <div className={styles.stateError}>{error}</div>;

  const pending = applications.filter(
    (a) => a.status === "submitted" || a.status === "clarification",
  );
  const reviewed = applications.filter(
    (a) => a.status === "approved" || a.status === "rejected",
  );

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>
        Application Review{" "}
        <span className={styles.count}>{pending.length} pending</span>
      </h1>

      {applications.length === 0 && (
        <p className={styles.emptyState}>No applications yet.</p>
      )}

      {pending.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Pending</h2>
          {pending.map((a) => (
            <ApplicationCard key={a.id} app={a} onUpdate={handleUpdate} />
          ))}
        </section>
      )}

      {reviewed.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Reviewed</h2>
          {reviewed.map((a) => (
            <ApplicationCard key={a.id} app={a} onUpdate={handleUpdate} />
          ))}
        </section>
      )}
    </div>
  );
}
