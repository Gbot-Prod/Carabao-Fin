"""
Export runs as clean, labelled CSVs for tabulating elsewhere.

Values are plain numbers (no thousands separators or markdown), and every row says
which run it came from. 00_table_index.csv describes each file and its columns.

Run:  uv run python scripts/perf/export_tables.py --out <dir> \
          --run before_fix=<run dir> --run after_fix=<run dir>
"""

import argparse
import csv
import json
from pathlib import Path

from analyze import (
    level_dirs,
    load_samples,
    read_csv,
    statement_counts,
    stats,
    verdict,
)
from targets import (
    EXTERNAL_ENDPOINTS,
    MAX_ERROR_RATE,
    P95_TARGET_MS,
    endpoint_class,
)

SLOWEST_STATEMENTS = 25


def num(value: float | None, digits: int = 1) -> float | str:
    return "" if value is None else round(value, digits)


def percent(part: int, whole: int) -> float:
    return round(100 * part / whole, 2) if whole else 0.0


def change_percent(before: float | str, after: float | str) -> float | str:
    if before in ("", 0) or after == "":
        return ""
    return round(100 * (after - before) / before, 1)


class Run:
    def __init__(self, version: str, path: Path) -> None:
        self.version = version
        self.path = path
        self.manifest = json.loads((path / "manifest.json").read_text())
        self.warmup = self.manifest["warmup_seconds"]
        (
            self.client,
            self.server,
            self.queries,
            self.query_by_level,
            self.load,
            self.external,
            self.statements,
        ) = load_samples(path, self.warmup)
        self.stubs = {
            name for name in ("paymongo", "mapbox") if self.manifest[name] == "stub"
        }


def load_summary(runs: list[Run]) -> list[dict]:
    limit = P95_TARGET_MS["external"]
    rows = []
    for run in runs:
        seconds = run.manifest["duration_seconds"] * run.manifest["repeats"]
        for users, (errors, total) in sorted(run.load["errors"].items()):
            values = run.load["ok"][users]
            summary = stats(values)
            rows.append(
                {
                    "version": run.version,
                    "concurrent_users": users,
                    "requests_measured": total,
                    "requests_per_second": num(total / seconds, 2),
                    "p50_ms": num(summary["p50"]),
                    "p95_ms": num(summary["p95"]),
                    "max_ms": num(summary["max"]),
                    "errors": errors,
                    "error_rate_percent": percent(errors, total),
                    "connection_pool_timeouts": run.load["pool_timeouts"][users],
                    "target_p95_ms": limit,
                    "target_error_rate_percent": MAX_ERROR_RATE * 100,
                    "target_met": verdict(
                        summary["p95"],
                        summary["n"],
                        errors / total if total else 0,
                        limit,
                        n_over_target=sum(v > limit for v in values),
                    ),
                }
            )
    return rows


def endpoint_rows(runs: list[Run]) -> list[dict]:
    rows = []
    for run in runs:
        for (endpoint, users), bucket in sorted(run.client.items()):
            summary = stats(bucket["ok"])
            total = summary["n"] + bucket["errors"]
            klass = endpoint_class(endpoint)
            target = P95_TARGET_MS[klass]
            method, path = endpoint.split(" ", 1)
            rows.append(
                {
                    "version": run.version,
                    "method": method,
                    "endpoint": path,
                    "endpoint_type": klass,
                    "concurrent_users": users,
                    "successful_requests_n": summary["n"],
                    "p50_ms": num(summary["p50"]),
                    "p95_ms": num(summary["p95"]),
                    "max_ms": num(summary["max"]),
                    "errors": bucket["errors"],
                    "error_rate_percent": percent(bucket["errors"], total),
                    "target_p95_ms": target,
                    "target_met": verdict(
                        summary["p95"],
                        summary["n"],
                        bucket["errors"] / total if total else 0,
                        target,
                        EXTERNAL_ENDPOINTS.get(endpoint) in run.stubs,
                        sum(v > target for v in bucket["ok"]),
                    ),
                }
            )
    return rows


def compare_endpoints(rows: list[dict], before: str, after: str) -> list[dict]:
    index = {
        (r["version"], r["method"], r["endpoint"], r["concurrent_users"]): r
        for r in rows
    }
    keys = sorted({(r["method"], r["endpoint"], r["concurrent_users"]) for r in rows})
    result = []
    for method, endpoint, users in keys:
        old = index.get((before, method, endpoint, users), {})
        new = index.get((after, method, endpoint, users), {})
        result.append(
            {
                "method": method,
                "endpoint": endpoint,
                "concurrent_users": users,
                "before_n": old.get("successful_requests_n", 0),
                "after_n": new.get("successful_requests_n", 0),
                "before_p50_ms": old.get("p50_ms", ""),
                "after_p50_ms": new.get("p50_ms", ""),
                "before_p95_ms": old.get("p95_ms", ""),
                "after_p95_ms": new.get("p95_ms", ""),
                "p95_change_percent": change_percent(
                    old.get("p95_ms", ""), new.get("p95_ms", "")
                ),
                "target_p95_ms": (new or old)["target_p95_ms"],
                "before_target_met": old.get("target_met", "No data"),
                "after_target_met": new.get("target_met", "No data"),
            }
        )
    return result


def db_time(runs: list[Run]) -> list[dict]:
    target = P95_TARGET_MS["db_query"]
    rows = []
    for run in runs:
        for users, values in sorted(run.query_by_level.items()):
            summary = stats(values)
            rows.append(
                {
                    "version": run.version,
                    "concurrent_users": users,
                    "queries_measured": summary["n"],
                    "p50_ms": num(summary["p50"], 3),
                    "p95_ms": num(summary["p95"], 3),
                    "max_ms": num(summary["max"], 3),
                    "target_p95_ms": target,
                    "target_met": verdict(summary["p95"], summary["n"], 0, target),
                }
            )
    return rows


def statements_per_request(runs: list[Run], before: str, after: str) -> list[dict]:
    means = {
        run.version: dict(
            (endpoint, (requests, mean))
            for endpoint, requests, mean in statement_counts(run.path, run.warmup)
        )
        for run in runs
    }
    endpoints = sorted({e for by_endpoint in means.values() for e in by_endpoint})
    rows = []
    for endpoint in endpoints:
        method, path = endpoint.split(" ", 1)
        old = means.get(before, {}).get(endpoint, ("", ""))
        new = means.get(after, {}).get(endpoint, ("", ""))
        old_mean = num(old[1]) if old[1] != "" else ""
        new_mean = num(new[1]) if new[1] != "" else ""
        rows.append(
            {
                "method": method,
                "endpoint": path,
                "before_mean_statements": old_mean,
                "after_mean_statements": new_mean,
                "change_percent": change_percent(old_mean, new_mean),
                "before_requests": old[0],
                "after_requests": new[0],
            }
        )
    return rows


def slowest_statements(runs: list[Run]) -> list[dict]:
    rows = []
    for run in runs:
        pooled: dict[str, list[float]] = {}
        for (statement_id, _), values in run.queries.items():
            pooled.setdefault(statement_id, []).extend(values)
        ranked = sorted(
            pooled.items(), key=lambda item: stats(item[1])["p95"], reverse=True
        )
        for rank, (statement_id, values) in enumerate(
            ranked[:SLOWEST_STATEMENTS], start=1
        ):
            summary = stats(values)
            rows.append(
                {
                    "version": run.version,
                    "rank_by_p95": rank,
                    "statement_id": statement_id,
                    "executions_n": summary["n"],
                    "p50_ms": num(summary["p50"], 3),
                    "p95_ms": num(summary["p95"], 3),
                    "max_ms": num(summary["max"], 3),
                    "sql": run.statements.get(statement_id, ""),
                }
            )
    return rows


def explain(runs: list[Run]) -> list[dict]:
    return [
        {
            "version": run.version,
            "query": row["query"],
            "runs": row["runs"],
            "median_execution_ms": row["median_exec_ms"],
            "max_execution_ms": row["max_exec_ms"],
            "planning_ms": row["plan_ms"],
            "sequential_scans": row["seq_scans"] or "none",
            "indexes_used": row["indexes_used"] or "none",
        }
        for run in runs
        for row in read_csv(run.path / "explain.csv")
    ]


def order_status(runs: list[Run]) -> list[dict]:
    target = P95_TARGET_MS["order_status"]
    rows = []
    for run in runs:
        groups: dict[tuple[int, str], list[dict]] = {}
        for row in read_csv(run.path / "order_latency" / "order_status.csv"):
            groups.setdefault((int(row["poll_ms"]), row["transition"]), []).append(row)
        for (poll_ms, transition), group in sorted(groups.items()):
            seen = [r for r in group if r["seen"] == "1"]
            lower = stats([float(r["from_ack_ms"]) for r in seen])
            upper = stats([float(r["from_send_ms"]) for r in seen])
            patch = stats([float(r["patch_ms"]) for r in group])
            rows.append(
                {
                    "version": run.version,
                    "buyer_poll_interval_ms": poll_ms,
                    "status_transition": transition,
                    "trials_n": len(group),
                    "not_seen": len(group) - len(seen),
                    "lower_bound_p50_ms": num(lower["p50"]),
                    "upper_bound_p50_ms": num(upper["p50"]),
                    "upper_bound_p95_ms": num(upper["p95"]),
                    "upper_bound_max_ms": num(upper["max"]),
                    "status_update_request_p95_ms": num(patch["p95"]),
                    "target_p95_ms": target,
                    "target_met": verdict(
                        upper["p95"],
                        upper["n"],
                        (len(group) - len(seen)) / len(group),
                        target,
                        "mapbox" in run.stubs and transition == "shipped",
                    ),
                }
            )
    return rows


def webhook(runs: list[Run]) -> list[dict]:
    target = P95_TARGET_MS["write"]
    rows = []
    for run in runs:
        trials = read_csv(run.path / "order_latency" / "webhook.csv")
        if not trials:
            continue
        good = [
            float(r["ms"]) for r in trials if r["http"] == "200" and r["settled"] == "1"
        ]
        summary = stats(good)
        failed = len(trials) - len(good)
        rows.append(
            {
                "version": run.version,
                "trials_n": len(trials),
                "failed": failed,
                "p50_ms": num(summary["p50"]),
                "p95_ms": num(summary["p95"]),
                "max_ms": num(summary["max"]),
                "target_p95_ms": target,
                "target_met": verdict(
                    summary["p95"], summary["n"], failed / len(trials), target
                ),
            }
        )
    return rows


def conditions(runs: list[Run]) -> list[dict]:
    keys = [
        "started_utc",
        "paymongo",
        "mapbox",
        "users",
        "warmup_seconds",
        "duration_seconds",
        "repeats",
        "order_trials",
        "git_commit",
        "database_host",
        "postgres_version",
        "machine",
        "cpu_count",
        "server_workers",
    ]
    rows = [
        {
            "version": run.version,
            **{key: run.manifest[key] for key in keys},
            "levels_recorded": len(level_dirs(run.path)),
        }
        for run in runs
    ]
    return rows


TABLES = [
    (
        "01_load_summary_by_concurrency.csv",
        "Overall throughput and latency per concurrency level. Start here.",
    ),
    (
        "02_endpoint_response_time_all_versions.csv",
        "Client-side response time per endpoint and level, one row per version.",
    ),
    (
        "03_endpoint_p95_before_vs_after.csv",
        "Same endpoints side by side, with the p95 change. Negative means faster.",
    ),
    (
        "04_database_query_time_by_concurrency.csv",
        "Time per SQL statement at the cursor. Excludes waiting for a free connection.",
    ),
    (
        "05_sql_statements_per_request_before_vs_after.csv",
        "Mean SQL statements each request runs. Shows the effect of batched loading.",
    ),
    (
        "06_slowest_sql_statements.csv",
        f"Top {SLOWEST_STATEMENTS} statements by p95 per version, with full SQL.",
    ),
    (
        "07_explain_analyze_key_queries.csv",
        "Database plans for key queries: execution time, sequential scans, indexes.",
    ),
    (
        "08_order_status_latency.csv",
        "Merchant status change until buyer sees it, on an idle server. Upper bound "
        "starts when the update is sent; lower bound when its response arrives.",
    ),
    (
        "09_payment_webhook_handler.csv",
        "Signed webhook replay. Handler time only; excludes PayMongo delivery delay.",
    ),
    (
        "10_test_conditions.csv",
        "Settings each version ran under. Cite these alongside the numbers.",
    ),
]


def write(path: Path, rows: list[dict]) -> int:
    if not rows:
        path.write_text("no data\n", encoding="utf-8")
        return 0
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--run",
        action="append",
        required=True,
        metavar="VERSION=DIR",
        help="Give the older run first, e.g. before_fix=<dir>.",
    )
    args = parser.parse_args()

    runs = []
    for spec in args.run:
        version, path = spec.split("=", 1)
        runs.append(Run(version, Path(path)))
    before, after = runs[0].version, runs[-1].version

    args.out.mkdir(parents=True, exist_ok=True)
    endpoints = endpoint_rows(runs)
    contents = [
        load_summary(runs),
        endpoints,
        compare_endpoints(endpoints, before, after),
        db_time(runs),
        statements_per_request(runs, before, after),
        slowest_statements(runs),
        explain(runs),
        order_status(runs),
        webhook(runs),
        conditions(runs),
    ]

    index = []
    for (name, description), rows in zip(TABLES, contents, strict=True):
        count = write(args.out / name, rows)
        index.append(
            {
                "file": name,
                "description": description,
                "rows": count,
                "columns": "; ".join(rows[0]) if rows else "",
            }
        )
    write(args.out / "00_table_index.csv", index)
    print(f"Wrote {len(index) + 1} files to {args.out}")


if __name__ == "__main__":
    main()
