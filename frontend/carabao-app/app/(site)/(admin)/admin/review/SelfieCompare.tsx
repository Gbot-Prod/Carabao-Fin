"use client";

import { useState } from "react";
import { fetchGovIdDocumentUrl, fetchSelfieDocumentUrl, type MerchantApplication } from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import styles from "./page.module.css";

type Loaded = { selfie: string; govId: string; govIdIsImage: boolean };

/**
 * The selfie with ID next to the uploaded government ID, so the admin can
 * compare the faces before they tick "Selfie matches the government ID".
 * The signed links last 60 s: enough to load the images once.
 */
export default function SelfieCompare({
  app,
  onOpenGovId,
}: {
  app: MerchantApplication;
  /** A PDF ID cannot show here (frame-src): open it in a new tab instead. */
  onOpenGovId: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!app.selfie_document_original_name) return null;

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

  return (
    <div className={styles.selfieCompare}>
      <div className={styles.selfieCompareHeader}>
        <span className={styles.selfieCompareLabel}>Selfie with ID</span>
        <button type="button" className={styles.docLink} onClick={() => void load()} disabled={loading}>
          {loading ? "Loading..." : loaded ? "Reload" : "Compare selfie and ID"}
        </button>
      </div>
      {loaded && (
        <div className={styles.selfieCompareGrid}>
          <figure className={styles.selfieCompareFigure}>
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
            <img src={loaded.selfie} alt="Applicant's selfie with ID" />
            <figcaption>Selfie with ID</figcaption>
          </figure>
          <figure className={styles.selfieCompareFigure}>
            {loaded.govIdIsImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img src={loaded.govId} alt="Uploaded government ID" />
            ) : (
              <button type="button" className={styles.docLink} onClick={onOpenGovId}>
                The ID is a PDF: open it in a new tab
              </button>
            )}
            <figcaption>Government ID ({app.gov_id_type ?? "type not set"})</figcaption>
          </figure>
        </div>
      )}
      {error && <span className={styles.actionError}>{error}</span>}
    </div>
  );
}
