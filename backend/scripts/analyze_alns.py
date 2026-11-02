"""
Statistics for scripts/evaluate_alns.py: reads its CSVs, writes summary.md and
stats.csv next to them.

Every comparison is paired (same batch, same matrix). Reported per size:
  gap_pct     mean % above the proven optimum
  diff_pct    mean % by which the comparator is longer than ALNS, with a 95%
              bootstrap CI; negative means the comparator beat ALNS
  W/T/L       batches where ALNS is better / tied (within 0.01 min) / worse
  p_holm      two-sided Wilcoxon signed-rank test, Holm-corrected over all tests
  rbc         matched-pairs rank-biserial correlation (effect size)

Run:  uv run --no-project --python 3.13 --with numpy --with scipy \
          python scripts/analyze_alns.py
"""

import csv
import statistics
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy import stats

RESULTS = Path(__file__).resolve().parent / "results" / "alns"
TIE_MIN = 0.01
COMPARATORS = (
    "point_to_point",
    "batch_fifo",
    "nearest_neighbour",
    "nn_2opt",
    "nn_2opt_oropt",
    "alns_uniform_ops",
    "ortools_first",
    "ortools_gls_equal_time",
    "ortools_gls_2s",
)
LABELS = {
    "point_to_point": "Point-to-point (1 trip per order)",
    "batch_fifo": "Batched, order received",
    "nearest_neighbour": "Nearest neighbour",
    "nn_2opt": "NN + 2-opt",
    "nn_2opt_oropt": "NN + 2-opt + Or-opt (ALNS start)",
    "alns": "ALNS (production)",
    "alns_uniform_ops": "ALNS, adaptive weights off",
    "ortools_first": "OR-Tools first solution",
    "ortools_gls_equal_time": "OR-Tools GLS, same time as ALNS",
    "ortools_gls_2s": "OR-Tools GLS, 2 s",
    "exact_cpsat": "CP-SAT (proven optimum)",
}


def read(name: str) -> list[dict]:
    with (RESULTS / name).open(newline="") as f:
        return list(csv.DictReader(f))


def key(r: dict) -> tuple:
    return r["dataset"], r["hub"], int(r["size"]), int(r["batch"])


def bootstrap_ci(values: np.ndarray, seed: int = 2026) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    picks = rng.integers(0, len(values), (10_000, len(values)))
    means = values[picks].mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def rank_biserial(diffs: np.ndarray) -> float:
    nonzero = diffs[np.abs(diffs) > 1e-9]
    if not len(nonzero):
        return 0.0
    ranks = stats.rankdata(np.abs(nonzero))
    return float(
        (ranks[nonzero > 0].sum() - ranks[nonzero < 0].sum()) / ranks.sum()
    )


def holm(pvalues: list[float]) -> list[float]:
    order = np.argsort(pvalues)
    adjusted = [0.0] * len(pvalues)
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, (len(pvalues) - rank) * pvalues[i])
        adjusted[i] = min(1.0, running)
    return adjusted


def main() -> None:
    table: dict[tuple, dict[str, dict]] = defaultdict(dict)
    for r in read("heuristics.csv"):
        table[key(r)][r["algo"]] = r
    exact = read("exact.csv")
    for r in exact:
        table[key(r)]["exact_cpsat"] = r

    lines = ["# ALNS evaluation results", ""]
    add = lines.append

    # ---- integrity -------------------------------------------------------
    crosscheck = read("crosscheck.csv")
    worst = max(abs(float(r["cpsat"]) - float(r["held_karp"])) for r in crosscheck)
    not_optimal = [r for r in exact if r["status"] != "OPTIMAL"]
    add("## Integrity")
    add(f"- Instances: {len(table)}; proven optimal: {len(exact) - len(not_optimal)}")
    add(
        f"- CP-SAT vs Held-Karp on {len(crosscheck)} instances: "
        f"worst difference {worst:.4f} min"
    )
    add("")

    # ---- paired statistics -----------------------------------------------
    out, pvalues = [], []
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for k, algos in table.items():
        groups[k[0], k[2]].append(algos)
    for (dataset, size), batch in sorted(groups.items()):
        alns = np.array([float(a["alns"]["drive_min"]) for a in batch])
        best = np.array([float(a["exact_cpsat"]["drive_min"]) for a in batch])
        # Rounding to integer costs can leave CP-SAT a hair above a real optimum.
        best = np.minimum(best, alns)
        for algo in COMPARATORS:
            other = np.array([float(a[algo]["drive_min"]) for a in batch])
            diffs = other - alns
            pct = 100 * diffs / alns
            low, high = bootstrap_ci(pct)
            if np.all(np.abs(diffs) < 1e-9):
                p = 1.0
            else:
                p = float(stats.wilcoxon(other, alns, zero_method="wilcox").pvalue)
            pvalues.append(p)
            out.append(
                {
                    "dataset": dataset,
                    "size": size,
                    "comparator": algo,
                    "n": len(batch),
                    "alns_min": alns.mean(),
                    "other_min": other.mean(),
                    "diff_pct": pct.mean(),
                    "ci_low": low,
                    "ci_high": high,
                    "alns_better": int((diffs > TIE_MIN).sum()),
                    "tied": int((np.abs(diffs) <= TIE_MIN).sum()),
                    "alns_worse": int((diffs < -TIE_MIN).sum()),
                    "p": p,
                    "rbc": rank_biserial(diffs),
                    "other_gap_pct": (100 * (other - best) / best).mean(),
                    "other_optimal_pct": 100
                    * (other - best <= TIE_MIN).mean(),
                }
            )
    for r, p in zip(out, holm(pvalues), strict=True):
        r["p_holm"] = p
    with (RESULTS / "stats.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(out[0]))
        writer.writeheader()
        writer.writerows(out)

    # ---- ALNS alone -------------------------------------------------------
    add("## ALNS against the proven optimum")
    add("| dataset | stops | n | mean gap % | max gap % | optimal % | mean min |")
    add("|---|---|---|---|---|---|---|")
    for (dataset, size), batch in sorted(groups.items()):
        alns = np.array([float(a["alns"]["drive_min"]) for a in batch])
        best = np.minimum(
            np.array([float(a["exact_cpsat"]["drive_min"]) for a in batch]), alns
        )
        gap = 100 * (alns - best) / best
        add(
            f"| {dataset} | {size} | {len(batch)} | {gap.mean():.3f} | "
            f"{gap.max():.2f} | {100 * (alns - best <= TIE_MIN).mean():.0f} | "
            f"{alns.mean():.1f} |"
        )
    add("")

    # ---- head to head -----------------------------------------------------
    for dataset in ("holdout", "tuning"):
        add(f"## Comparators vs ALNS ({dataset})")
        add(
            "| stops | comparator | n | longer than ALNS % [95% CI] | "
            "ALNS W/T/L | p (Holm) | rbc | gap to opt % | optimal % |"
        )
        add("|---|---|---|---|---|---|---|---|---|")
        for r in out:
            if r["dataset"] != dataset:
                continue
            add(
                f"| {r['size']} | {LABELS[r['comparator']]} | {r['n']} | "
                f"{r['diff_pct']:.2f} [{r['ci_low']:.2f}, {r['ci_high']:.2f}] | "
                f"{r['alns_better']}/{r['tied']}/{r['alns_worse']} | "
                f"{r['p_holm']:.2g} | {r['rbc']:.2f} | "
                f"{r['other_gap_pct']:.3f} | {r['other_optimal_pct']:.0f} |"
            )
        add("")

    # ---- per-hub check: batches from one hub share a customer pool -------
    add("## Per-hub check, holdout (mean % longer than ALNS)")
    hubs = sorted({k[1] for k in table if k[0] == "holdout"})
    add("| stops | comparator | " + " | ".join(hubs) + " |")
    add("|---|---|" + "---|" * len(hubs))
    for size in (20, 40):
        for algo in ("nn_2opt", "nn_2opt_oropt", "ortools_gls_equal_time"):
            cells = []
            for hub in hubs:
                pairs = [
                    (float(a[algo]["drive_min"]), float(a["alns"]["drive_min"]))
                    for k, a in table.items()
                    if k[0] == "holdout" and k[1] == hub and k[2] == size
                ]
                cells.append(
                    f"{statistics.mean(100 * (o - b) / b for o, b in pairs):.2f}"
                )
            add(f"| {size} | {LABELS[algo]} | " + " | ".join(cells) + " |")
    add("")

    # ---- run-to-run variation ---------------------------------------------
    robust = defaultdict(list)
    for r in read("robust.csv"):
        robust[key(r)].append(float(r["drive_min"]))
    add("## Run-to-run variation (30 seeds per instance, holdout)")
    add("| stops | instances | mean CV % | worst run gap % | runs at optimum % |")
    add("|---|---|---|---|---|")
    for size in sorted({k[2] for k in robust}):
        cvs, gaps, hits = [], [], []
        for k, values in robust.items():
            if k[2] != size:
                continue
            opt = min(float(table[k]["exact_cpsat"]["drive_min"]), min(values))
            cvs.append(100 * statistics.pstdev(values) / statistics.mean(values))
            gaps.append(100 * (max(values) - opt) / opt)
            hits.extend(v - opt <= TIE_MIN for v in values)
        add(
            f"| {size} | {len(cvs)} | {statistics.mean(cvs):.3f} | "
            f"{max(gaps):.2f} | {100 * statistics.mean(hits):.1f} |"
        )
    add("")

    # ---- iteration budget --------------------------------------------------
    budget = defaultdict(list)
    for r in read("budget.csv"):
        k = key(r)
        opt = float(table[k]["exact_cpsat"]["drive_min"])
        value = float(r["drive_min"])
        budget[int(r["size"]), r["budget"]].append(
            (100 * max(0.0, value - opt) / opt, float(r["solve_ms"]))
        )
    add("## Quality against iteration budget (holdout)")
    add("| stops | iterations | n | mean gap % | mean ms |")
    add("|---|---|---|---|---|")
    for (size, label), values in sorted(
        budget.items(), key=lambda kv: (kv[0][0], statistics.mean(v[1] for v in kv[1]))
    ):
        add(
            f"| {size} | {label} | {len(values)} | "
            f"{statistics.mean(v[0] for v in values):.3f} | "
            f"{statistics.mean(v[1] for v in values):.0f} |"
        )
    add("")

    # ---- runtime --------------------------------------------------------
    timing = defaultdict(list)
    for r in read("timing.csv"):
        timing[int(r["size"])].append(float(r["solve_ms"]))
    add("## ALNS runtime, one solve at a time")
    add("| stops | solves | median ms | p95 ms | max ms |")
    add("|---|---|---|---|---|")
    for size, values in sorted(timing.items()):
        add(
            f"| {size} | {len(values)} | {statistics.median(values):.0f} | "
            f"{np.percentile(values, 95):.0f} | {max(values):.0f} |"
        )
    add("")

    # ---- exact solver runtime ------------------------------------------------
    single = defaultdict(list)
    unproven = defaultdict(int)
    for r in read("exact_single_core.csv"):
        single[int(r["size"])].append(float(r["solve_ms"]))
        unproven[int(r["size"])] += r["status"] != "OPTIMAL"
    add("## CP-SAT runtime on one CPU core, one solve at a time (holdout)")
    add("| stops | solves | median ms | p95 ms | max ms | optimum not proven in 300 s |")
    add("|---|---|---|---|---|---|")
    for size, values in sorted(single.items()):
        add(
            f"| {size} | {len(values)} | {statistics.median(values):.0f} | "
            f"{np.percentile(values, 95):.0f} | {max(values):.0f} | "
            f"{unproven[size]} |"
        )
    add("")

    # ---- practical impact -------------------------------------------------
    add("## Practical impact, holdout (means per batch)")
    add("| stops | strategy | drive min | km | avg customer wait min |")
    add("|---|---|---|---|---|")
    for (dataset, size), batch in sorted(groups.items()):
        if dataset != "holdout":
            continue
        for algo in ("point_to_point", "batch_fifo", "nn_2opt", "alns"):
            add(
                f"| {size} | {LABELS[algo]} | "
                f"{statistics.mean(float(a[algo]['drive_min']) for a in batch):.1f} | "
                f"{statistics.mean(float(a[algo]['km']) for a in batch):.1f} | "
                f"{statistics.mean(float(a[algo]['avg_wait_min']) for a in batch):.1f} |"
            )
    add("")

    summary = RESULTS / "summary.md"
    summary.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
