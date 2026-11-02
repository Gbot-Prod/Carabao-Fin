"""
Figures for scripts/evaluate_alns.py, written to its results directory.

Run:  uv run --no-project --python 3.13 --with numpy --with matplotlib \
          python scripts/plot_alns.py
"""

import csv
import statistics
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results" / "alns"
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_SECONDARY = "#52514e"
GRID = "#e6e5e0"
SERIES = {
    "alns": ("ALNS (production)", "#2a78d6", "o"),
    "ortools_gls_equal_time": ("OR-Tools GLS, same time as ALNS", "#eb6834", "s"),
    "ortools_gls_2s": ("OR-Tools GLS, 2 s", "#1baf7a", "D"),
    "ortools_first": ("OR-Tools first solution", "#eda100", "^"),
    "nn_2opt": ("Nearest neighbour + 2-opt", "#e87ba4", "v"),
}


def read(name: str) -> list[dict]:
    with (RESULTS / name).open(newline="") as f:
        return list(csv.DictReader(f))


def style(ax) -> None:
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.tick_params(colors=INK_SECONDARY, length=0)


def bootstrap_ci(values: np.ndarray) -> tuple[float, float]:
    rng = np.random.default_rng(2026)
    means = values[rng.integers(0, len(values), (10_000, len(values)))].mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def optimality_gap_figure() -> None:
    optimum = {
        (r["hub"], int(r["size"]), r["batch"]): float(r["drive_min"])
        for r in read("exact.csv")
        if r["dataset"] == "holdout"
    }
    gaps: dict[str, dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))
    for r in read("heuristics.csv"):
        if r["dataset"] != "holdout" or r["algo"] not in SERIES:
            continue
        opt = optimum[r["hub"], int(r["size"]), r["batch"]]
        gaps[r["algo"]][int(r["size"])].append(
            100 * max(0.0, float(r["drive_min"]) - opt) / opt
        )

    fig, (full, zoom) = plt.subplots(1, 2, figsize=(10, 4.2), facecolor=SURFACE)
    for ax, algos, top, title in (
        (full, list(SERIES), None, "All solvers"),
        (zoom, list(SERIES)[:3], 1.1, "The three closest to optimal (zoomed)"),
    ):
        style(ax)
        for algo in reversed(algos):
            label, color, marker = SERIES[algo]
            sizes = sorted(gaps[algo])
            means = [statistics.mean(gaps[algo][s]) for s in sizes]
            cis = [bootstrap_ci(np.array(gaps[algo][s])) for s in sizes]
            ax.fill_between(
                sizes, [c[0] for c in cis], [c[1] for c in cis],
                color=color, alpha=0.15, linewidth=0,
            )
            ax.plot(
                sizes, means, color=color, marker=marker, markersize=6, linewidth=2,
                markeredgecolor=SURFACE, markeredgewidth=1.5, label=label,
            )
        ax.set_title(title, loc="left", color=INK, fontsize=11)
        ax.set_xlabel("Stops in batch", color=INK_SECONDARY)
        ax.set_xticks(sizes)
        ax.set_ylim(bottom=0, top=top)
    full.set_ylabel("Mean % above proven optimum", color=INK_SECONDARY)
    handles, labels = full.get_legend_handles_labels()
    fig.legend(
        handles[::-1], labels[::-1], loc="lower center", ncol=3, frameon=False,
        labelcolor=INK_SECONDARY, fontsize=9,
    )
    fig.tight_layout(rect=(0, 0.13, 1, 1))
    fig.savefig(RESULTS / "fig_optimality_gap.png", dpi=200, facecolor=SURFACE)


def runtime_figure() -> None:
    runs = {
        "ALNS, 1 core": (read("timing.csv"), "#2a78d6", "o"),
        "CP-SAT exact, 1 core": (read("exact_single_core.csv"), "#eb6834", "s"),
        "CP-SAT exact, 8 workers": (
            [r for r in read("exact.csv") if r["dataset"] == "holdout"],
            "#1baf7a",
            "D",
        ),
    }
    fig, ax = plt.subplots(figsize=(7, 4.2), facecolor=SURFACE)
    style(ax)
    for label, (rows, color, marker) in runs.items():
        by_size = defaultdict(list)
        for r in rows:
            by_size[int(r["size"])].append(float(r["solve_ms"]))
        sizes = sorted(by_size)
        medians = [statistics.median(by_size[s]) for s in sizes]
        p95 = [float(np.percentile(by_size[s], 95)) for s in sizes]
        ax.fill_between(sizes, medians, p95, color=color, alpha=0.15, linewidth=0)
        ax.plot(
            sizes, medians, color=color, marker=marker, markersize=6, linewidth=2,
            markeredgecolor=SURFACE, markeredgewidth=1.5, label=label,
        )
    ax.set_yscale("log")
    ax.set_xticks(sizes)
    ax.set_xlabel("Stops in batch", color=INK_SECONDARY)
    ax.set_ylabel("Solve time, ms (log scale)", color=INK_SECONDARY)
    ax.set_title(
        "Median solve time; shaded band reaches the 95th percentile",
        loc="left", color=INK, fontsize=11,
    )
    ax.legend(frameon=False, labelcolor=INK_SECONDARY, fontsize=9, loc="upper left")
    fig.tight_layout()
    fig.savefig(RESULTS / "fig_runtime.png", dpi=200, facecolor=SURFACE)


if __name__ == "__main__":
    optimality_gap_figure()
    runtime_figure()
