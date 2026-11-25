"use client";

import { useState } from "react";
import { CheckCircle2, CircleHelp, TriangleAlert, XCircle } from "lucide-react";
import { rerunDocumentChecks, type ChecklistItem, type ChecklistResult, type MerchantApplication } from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import styles from "./checklist.module.css";

export type DocumentKind = "rsbsa" | "govId" | "birCert" | "selfie";

const DOCUMENT_KIND: Record<NonNullable<ChecklistItem["document"]>, DocumentKind> = {
  rsbsa: "rsbsa",
  gov_id: "govId",
  bir_cert: "birCert",
  selfie: "selfie",
};

const RESULT: Record<ChecklistResult, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  pass: { label: "Pass", icon: CheckCircle2, tone: styles.pass },
  warn: { label: "Check", icon: TriangleAlert, tone: styles.warn },
  fail: { label: "Problem", icon: XCircle, tone: styles.fail },
  not_checked: { label: "Not checked", icon: CircleHelp, tone: styles.notChecked },
};

/** The warn and fail items: Accept needs each one ticked (the server checks too). */
export function itemsToConfirm(app: MerchantApplication): ChecklistItem[] {
  if (app.check_status !== "completed") return [];
  return (app.check_checklist ?? []).filter((i) => i.result === "warn" || i.result === "fail");
}

/** Pass items start ticked; so do items an admin already confirmed. */
export function initialTicks(app: MerchantApplication): Set<string> {
  const ticks = new Set(Object.keys(app.check_confirmations ?? {}));
  for (const item of app.check_checklist ?? []) if (item.result === "pass") ticks.add(item.id);
  return ticks;
}

/**
 * The automated checklist at the top of an application. It only assists: the
 * admin reads each item, opens the document and ticks it as reviewed.
 */
export default function ReviewChecklist({
  app,
  ticked,
  onToggle,
  onViewDocument,
  onUpdate,
  readOnly,
}: {
  app: MerchantApplication;
  ticked: Set<string>;
  onToggle: (id: string) => void;
  onViewDocument: (kind: DocumentKind) => void;
  onUpdate: (updated: MerchantApplication) => void;
  /** No decision is open (e.g. already reviewed): show results only. */
  readOnly: boolean;
}) {
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rerun = async () => {
    setRerunning(true);
    setError(null);
    try {
      onUpdate(await rerunDocumentChecks(app.id));
    } catch (err) {
      setError(getApiErrorMessage(err, "The checks could not run. Review the documents by hand."));
    } finally {
      setRerunning(false);
    }
  };

  const items = app.check_checklist ?? [];
  const status = app.check_status;
  const pendingCount = itemsToConfirm(app).filter((i) => !ticked.has(i.id)).length;

  return (
    <section className={styles.panel} aria-labelledby={`checklist-${app.id}`}>
      <div className={styles.head}>
        <h3 id={`checklist-${app.id}`} className={styles.title}>
          Automated checks
        </h3>
        {!readOnly && status === "completed" && (
          <span className={pendingCount ? styles.countWarn : styles.countOk}>
            {pendingCount ? `${pendingCount} to review` : "All reviewed"}
          </span>
        )}
        {app.status !== "pending_documents" && (
          <button type="button" className={styles.rerun} onClick={() => void rerun()} disabled={rerunning}>
            {rerunning ? "Running…" : "Re-run checks"}
          </button>
        )}
      </div>

      {status === "pending" && <p className={styles.state}>Checks are still running. You can review the documents by hand meanwhile.</p>}
      {status === "failed" && (
        <p className={styles.state}>The checks failed to run. Re-run them, or review the documents by hand; this does not block a decision.</p>
      )}
      {!status && app.status !== "pending_documents" && (
        <p className={styles.state}>No checks have run for this application. Re-run them, or review by hand.</p>
      )}
      {error && <p className={styles.error}>{error}</p>}

      {status === "completed" && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => {
            const result = RESULT[item.result];
            const Icon = result.icon;
            const needsTick = item.result === "warn" || item.result === "fail";
            const kind = item.document ? DOCUMENT_KIND[item.document] : null;
            return (
              <li key={item.id} className={styles.item}>
                <span className={`${styles.icon} ${result.tone}`} title={result.label}>
                  <Icon size={18} strokeWidth={2} aria-hidden="true" />
                  <span className={styles.srOnly}>{result.label}:</span>
                </span>
                <div className={styles.text}>
                  <span className={styles.label}>{item.label}</span>
                  <span className={styles.reason}>{item.reason}</span>
                  <span className={styles.links}>
                    {kind && (
                      <button type="button" className={styles.link} onClick={() => onViewDocument(kind)}>
                        Open document
                      </button>
                    )}
                    {item.related_application_ids.map((id) => (
                      <span key={id} className={styles.related}>
                        Application #{id}
                      </span>
                    ))}
                  </span>
                </div>
                {!readOnly && (
                  <label className={styles.tick}>
                    <input
                      type="checkbox"
                      checked={ticked.has(item.id)}
                      onChange={() => onToggle(item.id)}
                      aria-label={`Reviewed: ${item.label}`}
                    />
                    <span>{needsTick ? "Reviewed" : "OK"}</span>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.disclaimer}>
        The system doesn&apos;t verify numbers with DTI, SEC, CDA or the BIR. It only reads the uploaded documents. You make the
        decision.
      </p>
    </section>
  );
}
