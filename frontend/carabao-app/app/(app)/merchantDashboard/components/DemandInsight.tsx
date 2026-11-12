"use client";

import { useEffect, useState } from "react";
import styles from "../page.module.css";
import getApiErrorMessage from "@/util/errorHelper";
import { fetchMyDemand, type DemandInsight as Demand, type DemandSearchedTerm } from "@/util/api";

const listStyle = { margin: "0.25rem 0 0", paddingLeft: "1.25rem" } as const;

function Searches({ rows, empty }: { rows: DemandSearchedTerm[]; empty: string }) {
  if (!rows.length) return <p className={styles.kpiSub}>{empty}</p>;
  return (
    <ol style={listStyle}>
      {rows.map((s) => (
        <li key={s.query}>
          <strong>{s.query}</strong> — {s.searches} search{s.searches === 1 ? "" : "es"}
          {s.no_result_searches > 0 && (
            <span className={styles.warning}> · {s.no_result_searches} found nothing</span>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * F3: what buyers order and search for near this farm (last 30 days), to answer
 * the "farmers lack market demand information" problem. Counts only.
 */
export default function DemandInsight() {
  const [data, setData] = useState<Demand | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMyDemand()
      .then((d) => live && setData(d))
      .catch((err) => live && setError(getApiErrorMessage(err) ?? "Could not load demand insight."));
    return () => {
      live = false;
    };
  }, []);

  if (error) return <p className={styles.danger} role="alert">{error}</p>;
  if (!data) return null;

  return (
    <section className={styles.panel} aria-labelledby="demand-title">
      <h2 className={styles.panelTitle} id="demand-title">Demand in {data.province}</h2>
      <p className={styles.kpiSub}>Last {data.days} days, all farms in your province. Counts only; no farm or buyer is shown.</p>

      <div className={styles.overviewRow}>
        <div>
          <h3 className={styles.panelLabel}>Most ordered</h3>
          {data.most_ordered.length ? (
            <ol style={listStyle}>
              {data.most_ordered.map((p) => (
                <li key={p.name}>
                  <strong>{p.name}</strong> — {p.orders} order{p.orders === 1 ? "" : "s"}, {p.quantity} units
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.kpiSub}>No paid orders from farms in {data.province} yet.</p>
          )}
        </div>
        <div>
          <h3 className={styles.panelLabel}>Most searched in {data.province}</h3>
          <Searches rows={data.most_searched} empty={`No searches filtered to ${data.province} yet.`} />
        </div>
        <div>
          <h3 className={styles.panelLabel}>Most searched across Luzon</h3>
          <Searches rows={data.most_searched_luzon} empty="No searches yet." />
        </div>
      </div>
      <p className={styles.kpiSub}>
        &ldquo;Found nothing&rdquo; means buyers searched and no listing matched: a gap you could fill.
      </p>
    </section>
  );
}
