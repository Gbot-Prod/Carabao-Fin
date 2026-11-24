"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createProhibitedTerm,
  fetchProhibitedTerms,
  updateProhibitedTerm,
  type ProhibitedTerm,
  type TermCategory,
  type TermLanguage,
  type TermSeverity,
} from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import Pagination from "@/components/Pagination/Pagination";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import suspend from "../../suspend.module.css";
import PageHeader from "../../PageHeader";

const PAGE_SIZE = 50;

const CATEGORY_LABELS: Record<TermCategory, string> = {
  contact: "Contact / payment",
  prohibited_commodity: "Prohibited item",
  profanity: "Bad language",
  spam: "Spam",
};
const SEVERITY_LABELS: Record<TermSeverity, string> = {
  hard_block: "Hard block",
  soft_flag: "Soft flag",
};
const LANGUAGE_LABELS: Record<TermLanguage, string> = {
  all: "All",
  en: "English",
  tl: "Tagalog",
  ceb: "Bisaya",
};

type Active = "" | "on" | "off";

/**
 * Guardrails Phase 1: the words the listing checker looks for. A hard block
 * refuses the save; a soft flag sends the listing to the review queue. A word
 * is turned off, not deleted. Changes apply within a minute.
 */
export default function AdminTermsPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading word list…" />}>
      <TermsContent />
    </Suspense>
  );
}

function TermsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const category = (searchParams.get("category") as TermCategory | null) || "";
  const active = (searchParams.get("active") as Active) || "";
  const q = searchParams.get("q") || "";
  const key = `${category}|${active}|${q}|${page}`;

  const [rows, setRows] = useState<ProhibitedTerm[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);
  const [busy, setBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [draft, setDraft] = useState<{ term: string; category: TermCategory; severity: TermSeverity; language: TermLanguage }>({
    term: "",
    category: "prohibited_commodity",
    severity: "hard_block",
    language: "all",
  });
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchProhibitedTerms(
      {
        category: category || undefined,
        active: active === "on" ? true : active === "off" ? false : undefined,
        q: q || undefined,
      },
      page,
      PAGE_SIZE,
    )
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load the word list."))
      .finally(() => setLoadedKey(`${category}|${active}|${q}|${page}`));
  }, [category, active, q, page]);

  const loading = loadedKey !== key;

  const go = (next: { category?: string; active?: Active; q?: string; page?: number }) => {
    const params = new URLSearchParams();
    const c = next.category ?? category;
    const a = next.active ?? active;
    const query = next.q ?? q;
    if (c) params.set("category", c);
    if (a) params.set("active", a);
    if (query) params.set("q", query);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const change = async (row: ProhibitedTerm, changes: Partial<ProhibitedTerm>) => {
    setBusy(row.id);
    setRowError(null);
    try {
      const updated = await updateProhibitedTerm(row.id, changes);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      setRowError({ id: row.id, message: getApiErrorMessage(err) ?? "Could not save the change." });
    } finally {
      setBusy(null);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.term.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const created = await createProhibitedTerm({ ...draft, term: draft.term.trim() });
      setRows((prev) => [created, ...prev]);
      setTotal((n) => n + 1);
      setDraft({ ...draft, term: "" });
    } catch (err) {
      setAddError(getApiErrorMessage(err) ?? "Could not add the word.");
    } finally {
      setAdding(false);
    }
  };

  if (loading && rows.length === 0 && !error) return <PageLoader label="Loading word list…" />;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="People"
        title="Word list"
        count={total}
        description="Words the listing checker looks for in names and descriptions. A hard block stops the save; a soft flag sends the listing for review. Changes apply within a minute."
      />

      <form className={styles.filters} onSubmit={(e) => void add(e)}>
        <label className={styles.field}>
          <span>New word or phrase</span>
          <input value={draft.term} maxLength={120} onChange={(e) => setDraft({ ...draft, term: e.target.value })} placeholder="e.g. lambanog" />
        </label>
        <label className={styles.field}>
          <span>Category</span>
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as TermCategory })}>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Rule</span>
          <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as TermSeverity })}>
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Language</span>
          <select value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value as TermLanguage })}>
            {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={suspend.action} disabled={adding || !draft.term.trim()}>
          Add
        </button>
        {addError && <span className={suspend.error} role="alert">{addError}</span>}
      </form>

      <div className={styles.filters}>
        <label className={styles.field}>
          <span>Category</span>
          <select value={category} onChange={(e) => go({ category: e.target.value, page: 1 })}>
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Show</span>
          <select value={active} onChange={(e) => go({ active: e.target.value as Active, page: 1 })}>
            <option value="">On and off</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
        <form
          className={styles.field}
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: search.trim(), page: 1 });
          }}
        >
          <span>Search</span>
          <input type="search" aria-label="Search the word list" value={search} maxLength={120} onChange={(e) => setSearch(e.target.value)} />
        </form>
      </div>

      {error ? (
        <div className={styles.stateError}>{error}</div>
      ) : rows.length === 0 ? (
        <div className={styles.state}>No words match. Load the list with scripts/load_prohibited_terms.py.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Word</th>
                <th>Category</th>
                <th>Rule</th>
                <th>Language</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={styles.mono}>{row.term}</td>
                  <td>
                    <select
                      aria-label={`Category of ${row.term}`}
                      value={row.category}
                      disabled={busy === row.id}
                      onChange={(e) => void change(row, { category: e.target.value as TermCategory })}
                    >
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`Rule for ${row.term}`}
                      value={row.severity}
                      disabled={busy === row.id}
                      onChange={(e) => void change(row, { severity: e.target.value as TermSeverity })}
                    >
                      {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td>{LANGUAGE_LABELS[row.language] ?? row.language}</td>
                  <td>
                    <div className={suspend.wrap}>
                      <span className={row.is_active ? suspend.active : suspend.suspended}>{row.is_active ? "On" : "Off"}</span>
                      <button
                        type="button"
                        className={`${suspend.action} ${row.is_active ? suspend.danger : ""}`}
                        disabled={busy === row.id}
                        onClick={() => void change(row, { is_active: !row.is_active })}
                      >
                        {row.is_active ? "Turn off" : "Turn on"}
                      </button>
                      {rowError?.id === row.id && <span className={suspend.error} role="alert">{rowError.message}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} disabled={loading} onPageChange={(p) => go({ page: p })} />
    </div>
  );
}
