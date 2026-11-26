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
  type TermSort,
} from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import suspend from "../../suspend.module.css";
import PageHeader, { HeaderButton } from "../../PageHeader";
import TablePanel, { TablePage, TableFilter, TableSearch, TableSort, type SortOption } from "../../TablePanel";
import SortHeader, { readSort, writeSort, type SortState } from "../../SortHeader";
import AdminDialog from "../../AdminDialog";
import dialog from "../../adminDialog.module.css";
import { Plus } from "lucide-react";

const PAGE_SIZE = 50;
const SORT_KEYS = ["term", "category", "severity", "language", "active", "added"] as const;
/** The server's order when no sort is sent: A to Z. */
const DEFAULT_SORT: SortState<TermSort> = { sort: "term", order: "asc" };
const SORT_OPTIONS: SortOption<TermSort>[] = [
  { key: "term", label: "Word" },
  { key: "category", label: "Category" },
  { key: "severity", label: "Rule" },
  { key: "language", label: "Language" },
  { key: "active", label: "State" },
  { key: "added", label: "Date added", firstOrder: "desc" },
];

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
  const current = readSort<TermSort>(searchParams, SORT_KEYS, DEFAULT_SORT);
  const { sort, order } = current;
  const key = `${category}|${active}|${q}|${sort}|${order}|${page}`;

  const [rows, setRows] = useState<ProhibitedTerm[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchProhibitedTerms(
      {
        category: category || undefined,
        active: active === "on" ? true : active === "off" ? false : undefined,
        q: q || undefined,
        sort: sort ?? undefined,
        order,
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
      .finally(() => setLoadedKey(`${category}|${active}|${q}|${sort}|${order}|${page}`));
  }, [category, active, q, sort, order, page]);

  const loading = loadedKey !== key;

  const go = (next: { category?: string; active?: Active; q?: string; sort?: SortState<TermSort>; page?: number }) => {
    const params = new URLSearchParams();
    const c = next.category ?? category;
    const a = next.active ?? active;
    const query = next.q ?? q;
    const nextSort = next.sort ?? current;
    if (c) params.set("category", c);
    if (a) params.set("active", a);
    if (query) params.set("q", query);
    if (nextSort.sort !== DEFAULT_SORT.sort || nextSort.order !== DEFAULT_SORT.order) writeSort(params, nextSort);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const onSort = (next: SortState<TermSort>) => go({ sort: next, page: 1 });

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
      setAddOpen(false);
      setNotice(`Added "${created.term}".`);
    } catch (err) {
      setAddError(getApiErrorMessage(err) ?? "Could not add the word.");
    } finally {
      setAdding(false);
    }
  };

  const firstLoad = loading && rows.length === 0 && !error;

  return (
    <TablePage>
      <PageHeader
        eyebrow="People"
        title="Word list"
        count={total}
        description="Words the listing checker looks for in names and descriptions. A hard block stops the save; a soft flag sends the listing for review. Changes apply within a minute."
      >
        <HeaderButton icon={<Plus size={15} strokeWidth={2.25} aria-hidden="true" />} onClick={() => setAddOpen(true)}>
          Add word
        </HeaderButton>
      </PageHeader>

      {addOpen && (
        <AdminDialog
          title="Add a word or phrase"
          description="The checker matches it in listing names and descriptions, ignoring case and spacing."
          onClose={() => {
            setAddOpen(false);
            setAddError(null);
          }}
          locked={adding}
        >
          <form className={dialog.form} onSubmit={(e) => void add(e)}>
            <label className={dialog.field}>
              <span>Word or phrase</span>
              <input
                value={draft.term}
                maxLength={120}
                autoFocus
                onChange={(e) => setDraft({ ...draft, term: e.target.value })}
                placeholder="e.g. lambanog"
              />
            </label>
            <div className={dialog.row}>
              <label className={dialog.field}>
                <span>Category</span>
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as TermCategory })}>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className={dialog.field}>
                <span>Rule</span>
                <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as TermSeverity })}>
                  {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className={dialog.field}>
                <span>Language</span>
                <select value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value as TermLanguage })}>
                  {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
            {addError && <p className={dialog.error} role="alert">{addError}</p>}
            <div className={dialog.actions}>
              <button type="button" className={dialog.secondary} disabled={adding} onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button type="submit" className={dialog.primary} disabled={adding || !draft.term.trim()}>
                {adding ? "Adding…" : "Add word"}
              </button>
            </div>
          </form>
        </AdminDialog>
      )}

      <TablePanel
        activeFilters={[category, active].filter(Boolean).length}
        notice={notice ? { text: notice, onDismiss: () => setNotice(null) } : null}
        sort={<TableSort options={SORT_OPTIONS} current={current} onSort={onSort} defaultLabel="A to Z" />}
        filters={
          <>
            <TableFilter label="Category" value={category} onChange={(v) => go({ category: v, page: 1 })}>
              <option value="">All categories</option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </TableFilter>
            <TableFilter label="Show" value={active} onChange={(v) => go({ active: v as Active, page: 1 })}>
              <option value="">On and off</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </TableFilter>
          </>
        }
        search={<TableSearch applied={q} onSearch={(v) => go({ q: v, page: 1 })} placeholder="Search words" label="Search the word list" maxLength={120} />}
        message={firstLoad ? "Loading word list…" : error ?? (rows.length === 0 ? "No words match. Load the list with scripts/load_prohibited_terms.py." : null)}
        messageTone={error ? "error" : undefined}
        loading={loading}
        pagination={{ page, pageSize: PAGE_SIZE, total, onPageChange: (p) => go({ page: p }) }}
      >
          <table>
            <thead>
              <tr>
                <SortHeader label="Word" sortKey="term" current={current} onSort={onSort} />
                <SortHeader label="Category" sortKey="category" current={current} onSort={onSort} />
                <SortHeader label="Rule" sortKey="severity" current={current} onSort={onSort} />
                <SortHeader label="Language" sortKey="language" current={current} onSort={onSort} />
                <SortHeader label="State" sortKey="active" current={current} onSort={onSort} />
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
      </TablePanel>
    </TablePage>
  );
}
