"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, CircleHelp, ExternalLink, TriangleAlert, XCircle } from "lucide-react";
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

const DOCUMENT_OPEN_LABEL: Record<DocumentKind, string> = {
  rsbsa: "Open RSBSA",
  govId: "Open ID",
  birCert: "Open BIR",
  selfie: "Open Selfie",
};

const RESULT: Record<ChecklistResult, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  pass: { label: "Pass", icon: CheckCircle2, tone: styles.pass },
  warn: { label: "Needs review", icon: TriangleAlert, tone: styles.warn },
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

function submittedLegalName(app: MerchantApplication): string | null {
  const parts =
    app.seller_type === "corporation"
      ? [app.rep_first_name, app.rep_middle_name, app.rep_last_name, app.rep_suffix]
      : [app.first_name, app.middle_name, app.last_name, app.suffix];
  return parts.filter(Boolean).join(" ").trim() || null;
}

/**
 * The automated checklist at the top of an application. Exceptions (warn/fail)
 * are surfaced first; passed checks are collapsed into a compact summary.
 */
export default function ReviewChecklist({
  app,
  ticked,
  onToggle,
  onViewDocument,
  onCompareSelfie,
  onUpdate,
  readOnly,
}: {
  app: MerchantApplication;
  ticked: Set<string>;
  onToggle: (id: string) => void;
  onViewDocument: (kind: DocumentKind) => void;
  onCompareSelfie?: () => void;
  onUpdate: (updated: MerchantApplication) => void;
  /** No decision is open (e.g. already reviewed): show results only. */
  readOnly: boolean;
}) {
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassed, setShowPassed] = useState(false);

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

  const flaggedItems = items.filter((i) => i.result === "warn" || i.result === "fail");
  const passedItems = items.filter((i) => i.result === "pass" || i.result === "not_checked");
  const expectedName = submittedLegalName(app);

  const renderItem = (item: ChecklistItem, isFlagged: boolean) => {
    const result = RESULT[item.result];
    const Icon = result.icon;
    const needsTick = item.result === "warn" || item.result === "fail";
    const kind = item.document ? DOCUMENT_KIND[item.document] : null;
    const isNameCheck = item.id === "name_matches_id";
    const isSelfieCheck = item.id === "selfie_matches_id";

    return (
      <li
        key={item.id}
        className={`${styles.item} ${isFlagged ? (item.result === "fail" ? styles.itemFail : styles.itemWarn) : ""}`}
      >
        <span className={`${styles.icon} ${result.tone}`} title={result.label}>
          <Icon size={17} strokeWidth={2} aria-hidden="true" />
          <span className={styles.srOnly}>{result.label}:</span>
        </span>
        <div className={styles.text}>
          <div className={styles.labelRow}>
            <span className={styles.label}>{item.label}</span>
            {isFlagged && (
              <span className={`${styles.statusTag} ${item.result === "fail" ? styles.statusTagFail : styles.statusTagWarn}`}>
                {item.result === "fail" ? "Needs review" : "Manual check"}
              </span>
            )}
          </div>
          <span className={styles.reason}>{item.reason}</span>
          {isFlagged && isNameCheck && expectedName && (
            <div className={styles.nameComparison}>
              <span className={styles.nameComparisonLabel}>Submitted name:</span>
              <strong className={styles.nameComparisonValue}>{expectedName}</strong>
              {typeof app.name_match_score === "number" && (
                <span className={styles.matchScoreBadge}>{Math.round(app.name_match_score * 100)}% OCR match</span>
              )}
            </div>
          )}
          {item.related_application_ids.length > 0 && (
            <div className={styles.relatedList}>
              {item.related_application_ids.map((id) => (
                <span key={id} className={styles.related}>
                  Related: Application #{id}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={styles.rowActions}>
          {isSelfieCheck && onCompareSelfie ? (
            <button type="button" className={styles.actionLinkBtn} onClick={onCompareSelfie}>
              Compare Selfie &amp; ID
            </button>
          ) : (
            kind && (
              <button type="button" className={styles.actionLinkBtn} onClick={() => onViewDocument(kind)}>
                <span>{DOCUMENT_OPEN_LABEL[kind]}</span>
                <ExternalLink size={12} aria-hidden="true" />
              </button>
            )
          )}
          {!readOnly && (
            <label className={`${styles.tick} ${needsTick && !ticked.has(item.id) ? styles.tickPending : ""}`}>
              <input
                type="checkbox"
                checked={ticked.has(item.id)}
                onChange={() => onToggle(item.id)}
                aria-label={`Reviewed: ${item.label}`}
              />
              <span>{needsTick ? "Reviewed" : "OK"}</span>
            </label>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className={styles.panel} aria-labelledby={`checklist-${app.id}`}>
      <div className={styles.head}>
        <div className={styles.headLeft}>
          <h3 id={`checklist-${app.id}`} className={styles.title}>
            Automated checks
          </h3>
          {!readOnly && status === "completed" && (
            <span className={pendingCount ? styles.countWarn : styles.countOk}>
              {pendingCount ? `${pendingCount} to review` : "All reviewed"}
            </span>
          )}
        </div>
        {app.status !== "pending_documents" && (
          <button type="button" className={styles.rerun} onClick={() => void rerun()} disabled={rerunning}>
            {rerunning ? "Running…" : "Re-run checks"}
          </button>
        )}
      </div>

      {status === "pending" && (
        <p className={styles.state}>Checks are still running. You can review the documents by hand meanwhile.</p>
      )}
      {status === "failed" && (
        <p className={styles.state}>
          The checks failed to run. Re-run them, or review the documents by hand; this does not block a decision.
        </p>
      )}
      {!status && app.status !== "pending_documents" && (
        <p className={styles.state}>No checks have run for this application. Re-run them, or review by hand.</p>
      )}
      {error && <p className={styles.error}>{error}</p>}

      {status === "completed" && items.length > 0 && (
        <div className={styles.body}>
          {flaggedItems.length > 0 && (
            <ul className={styles.flaggedList}>{flaggedItems.map((item) => renderItem(item, true))}</ul>
          )}

          {passedItems.length > 0 && (
            <div className={styles.passedSection}>
              <button
                type="button"
                className={styles.passedToggle}
                onClick={() => setShowPassed((v) => !v)}
                aria-expanded={showPassed}
              >
                {showPassed ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                <span>
                  Passed checks ({passedItems.length}):{" "}
                  <span className={styles.passedSummary}>
                    {passedItems.map((i) => i.label).join(" · ")}
                  </span>
                </span>
              </button>
              {showPassed && <ul className={styles.passedList}>{passedItems.map((item) => renderItem(item, false))}</ul>}
            </div>
          )}
        </div>
      )}

      <p className={styles.disclaimer}>
        Note: Automated checks only read uploaded files and do not verify numbers with DTI, SEC, CDA, or the BIR.
      </p>
    </section>
  );
}
