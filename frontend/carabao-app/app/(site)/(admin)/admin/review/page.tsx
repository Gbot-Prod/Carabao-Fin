"use client";

import { useEffect, useState } from "react";
import {
  fetchAdminMerchantApplications,
  fetchBirCertDocumentUrl,
  fetchGovIdDocumentUrl,
  fetchRsbsaDocumentUrl,
  reviewMerchantApplication,
  type MerchantApplication,
} from "@/util/api/admin";
import { SELLER_TYPE_LABELS } from "@/util/api/merchants";
import getApiErrorMessage from "@/util/errorHelper";
import styles from "./page.module.css";
import ReviewChecklist, { initialTicks, itemsToConfirm, type DocumentKind } from "./ReviewChecklist";
import { ADMIN_LIST_LIMIT, ADMIN_LIST_MAX, mayHaveMore, mergeById } from "@/lib/admin-window";

// CF-0067: always load every application waiting for a decision, and the
// incomplete ones (Submit later); the reviewed ones come a window at a time.
const OPEN_STATUSES = ["submitted", "clarification", "pending_documents"];
import PageHeader from "../../PageHeader";
import PageLoader from "@/components/PageLoader/PageLoader";

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  clarification: "Needs Clarification",
  suspended: "Suspended",
  pending_documents: "Incomplete",
};

const VAT_LABELS: Record<string, string> = { vat_registered: "VAT-registered", non_vat: "Non-VAT" };

const personName = (...parts: (string | null)[]) => parts.filter(Boolean).join(" ") || null;
const dateTime = (value: string | null) => (value ? new Date(value).toLocaleString("en-PH") : null);

/** The small agricultural producer declaration (BIR RR No. 12-2023), as the admin reads it. */
function declarationText(app: MerchantApplication): string | null {
  if (app.small_agri_producer === null) return null;
  const year = app.small_agri_declared_year ? ` (declared ${app.small_agri_declared_year})` : "";
  return `${app.small_agri_producer ? "Yes" : "No"}${year}`;
}

const DOCUMENTS: Record<
  DocumentKind,
  { label: string; button: string; fetchUrl: typeof fetchRsbsaDocumentUrl }
> = {
  rsbsa: { label: "RSBSA document", button: "View RSBSA Document", fetchUrl: fetchRsbsaDocumentUrl },
  govId: { label: "government ID", button: "View Government ID", fetchUrl: fetchGovIdDocumentUrl },
  birCert: { label: "BIR Form 2303", button: "View BIR Form 2303", fetchUrl: fetchBirCertDocumentUrl },
};

const documentName = (app: MerchantApplication, kind: DocumentKind) =>
  kind === "rsbsa"
    ? app.rsbsa_document_original_name
    : kind === "govId"
      ? app.gov_id_document_original_name
      : app.bir_cert_document_original_name;

type ReviewAction = "approved" | "rejected" | "clarification" | "suspended";

// The moves the server allows (backend/app/services/application_review.py).
// Rejected and clarification wait for the applicant to send the form again.
const ALLOWED_ACTIONS: Record<string, ReviewAction[]> = {
  submitted: ["approved", "rejected", "clarification"],
  approved: ["suspended"],
};

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
  const [documentLoading, setDocumentLoading] = useState<DocumentKind | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const allowed = ALLOWED_ACTIONS[app.status] ?? [];
  // The checklist items the admin ticked as reviewed. Accept needs every warn
  // and fail item ticked; the server refuses otherwise.
  const [ticked, setTicked] = useState<Set<string>>(() => initialTicks(app));
  const [checkedAt, setCheckedAt] = useState(app.checked_at);
  if (checkedAt !== app.checked_at) {
    // A re-run is a new review: start from its results.
    setCheckedAt(app.checked_at);
    setTicked(initialTicks(app));
  }
  const toggleTick = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const unreviewed = itemsToConfirm(app).filter((i) => !ticked.has(i.id));
  const acceptBlocked = unreviewed.length > 0;

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
        action === "clarification" || action === "suspended" ? note.trim() || undefined : undefined,
        action === "approved" ? [...ticked] : [],
      );
      onUpdate(updated);
      setAction(null);
      setNote("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to update application. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmLabel =
    action === "approved"
      ? "Confirm Approval"
      : action === "rejected"
      ? "Confirm Rejection"
      : action === "suspended"
      ? "Confirm Suspension"
      : "Send Clarification Request";

  const handleViewDocument = async (kind: DocumentKind) => {
    const { label, fetchUrl } = DOCUMENTS[kind];
    setDocumentLoading(kind);
    setDocumentError(null);
    // Open synchronously so popup blockers do not reject the document after
    // the asynchronous URL request completes.
    const documentWindow = window.open("", "_blank");

    try {
      const { url } = await fetchUrl(app.id);
      if (!url || !/^https?:\/\//i.test(url)) {
        throw new Error(`The ${label} URL is invalid.`);
      }

      if (documentWindow) {
        documentWindow.opener = null;
        documentWindow.location.replace(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch {
      documentWindow?.close();
      setDocumentError(`Unable to open the ${label}.`);
    } finally {
      setDocumentLoading(null);
    }
  };

  return (
    <div className={styles.card}>
      <button className={styles.cardHeader} onClick={() => setOpen((v) => !v)}>
        <div className={styles.cardMeta}>
          <span className={styles.cardName}>
            {app.merchant_name ?? `Business information to follow (${app.contact_email})`}
          </span>
          <span className={styles.cardSub}>
            {[app.legal_business_name, `${app.city}, ${app.province}`].filter(Boolean).join(" · ")}
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
          {app.status !== "pending_documents" && (
            <ReviewChecklist
              app={app}
              ticked={ticked}
              onToggle={toggleTick}
              onViewDocument={(kind) => void handleViewDocument(kind)}
              onUpdate={onUpdate}
              readOnly={!allowed.includes("approved")}
            />
          )}
          <div className={styles.grid}>
            <Field label="Seller Type" value={app.seller_type ? SELLER_TYPE_LABELS[app.seller_type] ?? app.seller_type : null} />
            {(app.seller_type === "individual_farmer" || app.seller_type === "sole_proprietor") && (
              <Field label="Legal Name" value={personName(app.first_name, app.middle_name, app.last_name, app.suffix)} />
            )}
            {(app.seller_type === "corporation" || app.seller_type === "cooperative") && (
              <Field label="Registered Name" value={app.company_name} />
            )}
            {app.seller_type !== "individual_farmer" && <Field label="Trade Name" value={app.trade_name} />}
            {app.seller_type === "corporation" && (
              <Field
                label="Authorized Representative"
                value={personName(app.rep_first_name, app.rep_middle_name, app.rep_last_name, app.rep_suffix)}
              />
            )}
            <Field label="Contact Email" value={app.contact_email} />
            <Field label="Contact Number" value={app.contact_number} />
            <Field label="TIN" value={app.tin} />
            <Field label="VAT Status" value={app.vat_status ? VAT_LABELS[app.vat_status] : null} />
            <Field label="Small Agri Producer (RR 12-2023)" value={declarationText(app)} />
            <Field label="Registration Type" value={app.registration_type} />
            <Field label="Registration No." value={app.registration_number} />
            <Field label="Address" value={app.address} />
            <Field label="City / Province" value={`${app.city}, ${app.province}`} />
            <Field label="Region" value={app.region} />
            <Field label="Postal Code" value={app.postal_code} />
            <Field label="Available Days" value={app.available_days.join(", ")} />
            <Field label="RSBSA No." value={app.rsbsa_number} />
            <Field label="Government ID" value={app.gov_id_type} />
            <Field label="Submitted" value={dateTime(app.submitted_at)} />
            <Field
              label="Terms Accepted"
              value={app.terms_accepted_at ? `${dateTime(app.terms_accepted_at)} (version ${app.terms_version ?? "—"})` : null}
            />
          </div>

          <div className={styles.documentPanel}>
            {(["rsbsa", "govId", "birCert"] as const).map((kind) => {
              const fileName = documentName(app, kind);
              // Only the documents this application has (none while incomplete).
              if (!fileName) return null;
              return (
                <div key={kind} className={styles.documentRow}>
                  <button
                    type="button"
                    className={styles.docLink}
                    onClick={() => handleViewDocument(kind)}
                    disabled={documentLoading !== null}
                  >
                    {documentLoading === kind
                      ? "Preparing document..."
                      : DOCUMENTS[kind].button}
                  </button>
                  {fileName && <span className={styles.documentName}>{fileName}</span>}
                </div>
              );
            })}
            {documentError && (
              <span className={styles.actionError}>{documentError}</span>
            )}
          </div>

          {app.admin_note && (
            <div className={styles.adminNote}>
              <span className={styles.adminNoteLabel}>Admin Note</span>
              <p className={styles.adminNoteText}>{app.admin_note}</p>
            </div>
          )}

          {allowed.length === 0 ? (
            <p className={styles.adminNoteText}>
              {app.status === "suspended"
                ? "This merchant is suspended."
                : app.status === "pending_documents"
                  ? "Incomplete: the applicant chose Submit later and has not sent their business information yet. It can be reviewed once they do."
                  : "Waiting for the applicant to send the form again."}
            </p>
          ) : (
          <div className={styles.actionPanel}>
            <span className={styles.actionLabel}>Review Decision</span>
            <div className={styles.actionButtons}>
              {allowed.includes("approved") && (
              <button
                className={`${styles.actionBtn} ${styles.actionBtnApprove} ${action === "approved" ? styles.actionBtnSelected : ""}`}
                onClick={() => selectAction("approved")}
                disabled={acceptBlocked}
                title={acceptBlocked ? "Tick every flagged checklist item as reviewed first." : undefined}
              >
                Accept
              </button>
              )}
              {allowed.includes("rejected") && (
              <button
                className={`${styles.actionBtn} ${styles.actionBtnReject} ${action === "rejected" ? styles.actionBtnSelected : ""}`}
                onClick={() => selectAction("rejected")}
              >
                Reject
              </button>
              )}
              {allowed.includes("clarification") && (
              <button
                className={`${styles.actionBtn} ${styles.actionBtnClarify} ${action === "clarification" ? styles.actionBtnSelected : ""}`}
                onClick={() => selectAction("clarification")}
              >
                Request Clarification
              </button>
              )}
              {allowed.includes("suspended") && (
              <button
                className={`${styles.actionBtn} ${styles.actionBtnReject} ${action === "suspended" ? styles.actionBtnSelected : ""}`}
                onClick={() => selectAction("suspended")}
              >
                Suspend Merchant
              </button>
              )}
            </div>
            {allowed.includes("approved") && acceptBlocked && (
              <p className={styles.adminNoteText}>
                Accept is available once you tick the {unreviewed.length === 1 ? "flagged item" : `${unreviewed.length} flagged items`} above as
                reviewed. Reject and Request Clarification do not need the checklist.
              </p>
            )}

            {(action === "clarification" || action === "suspended") && (
              <textarea
                className={styles.noteInput}
                aria-label={action === "suspended" ? "Reason for the suspension" : "Clarification request for the applicant"}
                placeholder={action === "suspended" ? "Reason for the suspension (optional)…" : "Describe what additional information or corrections are needed from the applicant…"}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
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
                    (action === "clarification" && !note.trim()) ||
                    (action === "approved" && acceptBlocked)
                  }
                  onClick={handleSubmit}
                >
                  {submitting ? "Saving…" : confirmLabel}
                </button>
              </div>
            )}
          </div>
          )}
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
  const [recentLoaded, setRecentLoaded] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchAdminMerchantApplications({ status: OPEN_STATUSES, limit: ADMIN_LIST_MAX }),
      fetchAdminMerchantApplications({ limit: ADMIN_LIST_LIMIT }),
    ])
      .then(([open, recent]) => {
        setApplications(mergeById(open, recent));
        setRecentLoaded(recent.length);
        setHasMore(mayHaveMore(recent.length));
      })
      .catch(() => setError("Failed to load applications."))
      .finally(() => setLoading(false));
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const rows = await fetchAdminMerchantApplications({ limit: ADMIN_LIST_LIMIT, offset: recentLoaded });
      setApplications((prev) => mergeById(prev, rows));
      setRecentLoaded((n) => n + rows.length);
      setHasMore(mayHaveMore(rows.length));
    } catch {
      setError("Failed to load more applications.");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleUpdate = (updated: MerchantApplication) => {
    setApplications((prev) =>
      prev.map((a) => (a.id === updated.id ? updated : a)),
    );
  };

  if (loading) return <PageLoader label="Loading applications…" />;
  if (error) return <div className={styles.stateError}>{error}</div>;

  const pending = applications.filter(
    (a) => a.status === "submitted" || a.status === "clarification",
  );
  const reviewed = applications.filter(
    (a) => a.status === "approved" || a.status === "rejected" || a.status === "suspended",
  );
  const incomplete = applications.filter((a) => a.status === "pending_documents");

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="People"
        title="Merchant applications"
        count={`${pending.length} pending`}
        description="Approve, reject or ask a seller for more information before their store goes live."
      />

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

      {incomplete.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Incomplete (Submit later)</h2>
          {incomplete.map((a) => (
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
      {hasMore && (
        <p>
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load older applications"}
          </button>
        </p>
      )}
    </div>
  );
}
