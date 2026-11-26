"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { fetchGovIdDocumentUrl, fetchSelfieDocumentUrl, type MerchantApplication } from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import styles from "./page.module.css";

type Loaded = { selfie: string; govId: string; govIdIsImage: boolean };

/**
 * Side-by-side modal comparing the applicant's selfie with ID against the
 * uploaded government ID. The signed links last 60 s.
 */
export default function SelfieCompareModal({
  app,
  open,
  onClose,
  onOpenGovId,
}: {
  app: MerchantApplication;
  open: boolean;
  onClose: () => void;
  /** A PDF ID cannot show here (frame-src): open it in a new tab instead. */
  onOpenGovId: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [selfie, govId] = await Promise.all([
        fetchSelfieDocumentUrl(app.id),
        app.gov_id_document_original_name ? fetchGovIdDocumentUrl(app.id) : Promise.resolve(null),
      ]);
      setLoaded({
        selfie: selfie.url,
        govId: govId?.url ?? "",
        govIdIsImage: !!govId?.content_type?.startsWith("image/"),
      });
    } catch (e) {
      setError(getApiErrorMessage(e, "Could not load the selfie and the ID."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, app.id]);

  if (!open) return null;

  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label="Compare Selfie and Government ID">
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <h4 className={styles.modalTitle}>Compare Selfie &amp; Government ID</h4>
            <p className={styles.modalSub}>
              {app.merchant_name ?? app.contact_email} · {app.gov_id_type ?? "Government ID"}
            </p>
          </div>
          <div className={styles.modalHeaderActions}>
            <button type="button" className={styles.modalRefreshBtn} onClick={() => void load()} disabled={loading}>
              <RefreshCw size={13} aria-hidden="true" />
              <span>{loading ? "Loading…" : "Reload"}</span>
            </button>
            <button type="button" className={styles.modalCloseBtn} onClick={onClose} aria-label="Close comparison">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        {error && <p className={styles.actionError}>{error}</p>}

        {loading && !loaded ? (
          <div className={styles.modalLoading}>Loading signed document previews…</div>
        ) : loaded ? (
          <div className={styles.selfieCompareGrid}>
            <figure className={styles.selfieCompareFigure}>
              <figcaption>Selfie with ID</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
              <img src={loaded.selfie} alt="Applicant's selfie with ID" />
            </figure>
            <figure className={styles.selfieCompareFigure}>
              <figcaption>Government ID ({app.gov_id_type ?? "type not set"})</figcaption>
              {loaded.govId ? (
                loaded.govIdIsImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                  <img src={loaded.govId} alt="Uploaded government ID" />
                ) : (
                  <div className={styles.modalPdfFallback}>
                    <p>This Government ID is a PDF and cannot be previewed inline.</p>
                    <button type="button" className={styles.docCardBtn} onClick={onOpenGovId}>
                      Open Government ID in new tab
                    </button>
                  </div>
                )
              ) : (
                <div className={styles.modalPdfFallback}>No government ID uploaded.</div>
              )}
            </figure>
          </div>
        ) : null}
      </div>
    </div>
  );
}
