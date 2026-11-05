"""
Turn a run directory's raw samples into the SOP 3 tables, with a Met? verdict.

Latency percentiles use successful responses only, so fast failures can't flatter
them; failures are reported in the Errors column and fail the row on their own.
Warm-up is cut by timestamp from each level's first response.

Run:  uv run python scripts/perf/analyze.py scripts/results/perf/<run>
"""

import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
from targets import (
    EXTERNAL_ENDPOINTS,
    MAX_ERROR_RATE,
    MIN_SAMPLES,
    P95_TARGET_MS,
    endpoint_class,
)

SLOWEST_QUERIES = 15


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def stats(values: list[float]) -> dict:
    return {
        "n": len(values),
        "p50": float(np.percentile(values, 50)) if values else None,
        "p95": float(np.percentile(values, 95)) if values else None,
        "max": max(values) if values else None,
    }


def fmt(value: float | None) -> str:
    # Adding 0 turns a rounded -0 into 0.
    return "-" if value is None else f"{round(value) + 0:,}"


def fmt_fine(value: float | None) -> str:
    return "-" if value is None else f"{value:,.2f}"


def verdict(
    p95: float | None,
    n: int,
    error_rate: float,
    target: float,
    stubbed: bool = False,
    n_over_target: int = 0,
) -> str:
    if stubbed:
        return "Not judged (stubbed)"
    if n < MIN_SAMPLES:
        # A server that stalls finishes few requests, so low n can itself be the
        # symptom. Repeated misses count even when there are too few for a p95.
        if n_over_target >= 2:
            return "No (slow, low n)"
        return f"Not judged (n<{MIN_SAMPLES})"
    if error_rate >= MAX_ERROR_RATE:
        return "No (errors)"
    return "Yes" if p95 <= target else "No"


def table(headers: list[str], rows: list[list[str]]) -> list[str]:
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return lines


def write_csv(path: Path, headers: list[str], rows: list[list]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)


def level_dirs(run_dir: Path) -> list[tuple[int, int, Path]]:
    found = []
    for path in sorted(run_dir.glob("users_*_rep*")):
        match = re.fullmatch(r"users_(\d+)_rep(\d+)", path.name)
        found.append((int(match[1]), int(match[2]), path))
    return found


def load_samples(run_dir: Path, warmup: int):
    """Measured-window samples pooled by level, with p95s kept per repeat."""
    client = defaultdict(
        lambda: {"ok": [], "errors": 0, "by_repeat": defaultdict(list)}
    )
    server = defaultdict(list)
    queries = defaultdict(list)
    query_by_level = defaultdict(list)
    level_errors = defaultdict(lambda: [0, 0])
    level_ok = defaultdict(list)
    pool_timeouts = defaultdict(int)
    external = defaultdict(list)
    statements = {}

    for users, repeat, path in level_dirs(run_dir):
        client_rows = read_csv(path / "client.csv")
        if not client_rows:
            print(f"WARNING: no client samples in {path.name}")
            continue
        cutoff = min(float(r["wall_ts"]) for r in client_rows) + warmup
        for row in client_rows:
            if float(row["wall_ts"]) < cutoff:
                continue
            bucket = client[(row["endpoint"], users)]
            level_errors[users][1] += 1
            if row["ok"] == "1":
                bucket["ok"].append(float(row["ms"]))
                bucket["by_repeat"][repeat].append(float(row["ms"]))
                level_ok[users].append(float(row["ms"]))
            else:
                bucket["errors"] += 1
                level_errors[users][0] += 1
        log = path / "server.log"
        if log.exists():
            pool_timeouts[users] += sum(
                "Unhandled exception" in line and "QueuePool limit" in line
                for line in log.read_text(
                    encoding="utf-8", errors="replace"
                ).splitlines()
            )
        for row in read_csv(path / "requests.csv"):
            if float(row["wall_ts"]) >= cutoff and int(row["status"]) < 400:
                server[(row["endpoint"], users)].append(float(row["ms"]))
        for row in read_csv(path / "statements.csv"):
            statements[row["statement_id"]] = row["statement"]
        for row in read_csv(path / "queries.csv"):
            if float(row["wall_ts"]) >= cutoff:
                queries[(row["statement_id"], users)].append(float(row["ms"]))
                query_by_level[users].append(float(row["ms"]))
        for row in read_csv(path / "external_calls.csv"):
            if float(row["wall_ts"]) >= cutoff:
                external[(row["name"], users)].append(float(row["ms"]))
    load = {"errors": level_errors, "ok": level_ok, "pool_timeouts": pool_timeouts}
    return client, server, queries, query_by_level, load, external, statements


def api_section(run_dir: Path, client, load, manifest: dict, stubs: set[str]):
    repeats = manifest["repeats"]
    headers = [
        "Endpoint",
        "Concurrency",
        "n",
        "p50 (ms)",
        "p95 (ms)",
        "Max (ms)",
        "Errors",
        "Target (ms)",
        "Met?",
    ]
    if repeats > 1:
        headers.insert(6, "p95 per repeat (min-max)")

    rows, verdicts = [], []
    for (endpoint, users), bucket in sorted(client.items()):
        summary = stats(bucket["ok"])
        total = summary["n"] + bucket["errors"]
        error_rate = bucket["errors"] / total if total else 0
        klass = endpoint_class(endpoint)
        target = P95_TARGET_MS[klass]
        met = verdict(
            summary["p95"],
            summary["n"],
            error_rate,
            target,
            EXTERNAL_ENDPOINTS.get(endpoint) in stubs,
            sum(v > target for v in bucket["ok"]),
        )
        verdicts.append(met)
        row = [
            f"`{endpoint}`",
            users,
            summary["n"],
            fmt(summary["p50"]),
            fmt(summary["p95"]),
            fmt(summary["max"]),
            f"{bucket['errors']} ({error_rate:.1%})",
            target,
            met,
        ]
        if repeats > 1:
            per_repeat = [
                np.percentile(v, 95)
                for v in bucket["by_repeat"].values()
                if len(v) >= MIN_SAMPLES
            ]
            spread = (
                f"{min(per_repeat):,.0f}-{max(per_repeat):,.0f}" if per_repeat else "-"
            )
            row.insert(6, spread)
        rows.append(row)
    write_csv(run_dir / "api_client.csv", headers, rows)

    # Requests still stuck when a level ends are never logged, so a stalled server
    # shows up here as falling throughput rather than as errors.
    measured_seconds = manifest["duration_seconds"] * repeats
    limit = P95_TARGET_MS["external"]
    level_headers = [
        "Concurrency",
        "Requests",
        "Req/s",
        "p50 (ms)",
        "p95 (ms)",
        "Max (ms)",
        "Errors",
        "Pool timeouts",
        f"p95 <= {limit} ms and errors < {MAX_ERROR_RATE:.0%}?",
    ]
    level_rows = []
    for users, (errors, total) in sorted(load["errors"].items()):
        rate = errors / total if total else 0
        values = load["ok"][users]
        summary = stats(values)
        level_rows.append(
            [
                users,
                total,
                f"{total / measured_seconds:.1f}",
                fmt(summary["p50"]),
                fmt(summary["p95"]),
                fmt(summary["max"]),
                f"{errors} ({rate:.2%})",
                load["pool_timeouts"][users],
                verdict(
                    summary["p95"],
                    summary["n"],
                    rate,
                    limit,
                    n_over_target=sum(v > limit for v in values),
                ),
            ]
        )
    write_csv(run_dir / "load_summary.csv", level_headers, level_rows)
    return (
        ["## API response time, client side (Locust)", ""]
        + ["### Load summary, all endpoints", ""]
        + [
            "Throughput should rise with concurrency. If it falls, the system is "
            "saturated, even if few errors were recorded. The limit here is the "
            "loosest endpoint target.",
            "",
        ]
        + table(level_headers, level_rows)
        + ["", "### Per endpoint", ""]
        + table(headers, rows),
        verdicts + [r[-1] for r in level_rows],
    )


def network_section(run_dir: Path, client, server):
    headers = [
        "Endpoint",
        "Concurrency",
        "Client p95 (ms)",
        "Server p95 (ms)",
        "Outside app code (ms)",
    ]
    rows = []
    for (endpoint, users), bucket in sorted(client.items()):
        client_p95 = stats(bucket["ok"])["p95"]
        server_p95 = stats(server.get((endpoint, users), []))["p95"]
        gap = (
            client_p95 - server_p95
            if client_p95 is not None and server_p95 is not None
            else None
        )
        rows.append(
            [
                f"`{endpoint}`",
                users,
                fmt(client_p95),
                fmt(server_p95),
                fmt(gap),
            ]
        )
    write_csv(run_dir / "api_server.csv", headers, rows)
    return [
        "## Client vs server time",
        "",
        "The gap is network, connection setup and time spent queued before the "
        "server's middleware runs. Each p95 comes from its own samples, so small "
        "negative gaps are noise.",
        "",
    ] + table(headers, rows)


def db_section(run_dir: Path, queries, query_by_level, statements):
    target = P95_TARGET_MS["db_query"]
    verdicts, level_rows = [], []
    for users, values in sorted(query_by_level.items()):
        summary = stats(values)
        met = verdict(summary["p95"], summary["n"], 0, target)
        verdicts.append(met)
        level_rows.append(
            [
                users,
                summary["n"],
                fmt_fine(summary["p50"]),
                fmt_fine(summary["p95"]),
                fmt_fine(summary["max"]),
                target,
                met,
            ]
        )

    pooled = defaultdict(list)
    for (statement_id, _), values in queries.items():
        pooled[statement_id].extend(values)
    all_rows = sorted(
        (
            [
                statement_id,
                *(stats(values)[k] for k in ("n", "p50", "p95", "max")),
                statements.get(statement_id, ""),
            ]
            for statement_id, values in pooled.items()
        ),
        key=lambda row: row[3],
        reverse=True,
    )
    write_csv(
        run_dir / "db_queries.csv",
        ["statement_id", "n", "p50_ms", "p95_ms", "max_ms", "statement"],
        all_rows,
    )
    slow_rows = [
        [
            f"`{r[0]}`",
            r[1],
            fmt_fine(r[2]),
            fmt_fine(r[3]),
            fmt_fine(r[4]),
            f"`{r[5][:90]}`",
        ]
        for r in all_rows[:SLOWEST_QUERIES]
    ]

    lines = ["## Database query execution time", ""]
    lines += table(
        [
            "Concurrency",
            "Queries",
            "p50 (ms)",
            "p95 (ms)",
            "Max (ms)",
            "Target",
            "Met?",
        ],
        level_rows,
    )
    lines += ["", f"### {SLOWEST_QUERIES} slowest statements by p95, all levels", ""]
    lines += table(
        ["Id", "n", "p50 (ms)", "p95 (ms)", "Max (ms)", "Statement"], slow_rows
    )

    explain = read_csv(run_dir / "explain.csv")
    if explain:
        lines += ["", "### EXPLAIN ANALYZE on key queries", ""]
        lines += table(
            ["Query", "Median exec (ms)", "Sequential scans", "Indexes used"],
            [
                [
                    r["query"],
                    r["median_exec_ms"],
                    r["seq_scans"] or "none",
                    r["indexes_used"] or "none",
                ]
                for r in explain
            ],
        )
    return lines, verdicts


def statement_counts(run_dir: Path, warmup: int) -> list[tuple[str, int, float]]:
    """Per endpoint: requests and mean SQL statements, across all levels."""
    request_counts = defaultdict(int)
    query_counts = defaultdict(int)
    for _, _, path in level_dirs(run_dir):
        requests_rows = read_csv(path / "requests.csv")
        if not requests_rows:
            continue
        cutoff = min(float(r["wall_ts"]) for r in requests_rows) + warmup
        for row in requests_rows:
            if float(row["wall_ts"]) >= cutoff and int(row["status"]) < 400:
                request_counts[row["endpoint"]] += 1
        for row in read_csv(path / "queries.csv"):
            if float(row["wall_ts"]) >= cutoff:
                query_counts[row["endpoint"]] += 1
    return [
        (endpoint, count, query_counts[endpoint] / count)
        for endpoint, count in request_counts.items()
        if endpoint in query_counts
    ]


def queries_per_request(run_dir: Path, warmup: int):
    """Mean SQL statements per request: tells too many queries from a slow one."""
    rows = [
        [f"`{endpoint}`", count, f"{mean:.1f}"]
        for endpoint, count, mean in statement_counts(run_dir, warmup)
    ]
    rows.sort(key=lambda r: float(r[2]), reverse=True)
    if not rows:
        return []
    return ["", "### SQL statements per request", ""] + table(
        ["Endpoint", "Requests", "Mean statements"], rows
    )


def order_section(run_dir: Path, stubs: set[str]):
    rows_in = read_csv(run_dir / "order_latency" / "order_status.csv")
    if not rows_in:
        return [], []
    target = P95_TARGET_MS["order_status"]
    groups = defaultdict(list)
    for row in rows_in:
        groups[(int(row["poll_ms"]), row["transition"])].append(row)

    headers = [
        "Buyer polling",
        "Transition",
        "n",
        "Not seen",
        "Lower bound p50 (ms)",
        "Upper bound p50 (ms)",
        "Upper bound p95 (ms)",
        "Upper bound max (ms)",
        "PATCH p95 (ms)",
        "Target (ms)",
        "Met?",
    ]
    rows, verdicts = [], []
    for (poll_ms, transition), group in sorted(groups.items()):
        seen = [r for r in group if r["seen"] == "1"]
        upper = stats([float(r["from_send_ms"]) for r in seen])
        lower = stats([float(r["from_ack_ms"]) for r in seen])
        patch = stats([float(r["patch_ms"]) for r in group])
        not_seen = len(group) - len(seen)
        met = verdict(
            upper["p95"],
            upper["n"],
            not_seen / len(group),
            target,
            "mapbox" in stubs and transition == "shipped",
        )
        verdicts.append(met)
        rows.append(
            [
                f"{poll_ms} ms",
                transition,
                len(group),
                not_seen,
                fmt(lower["p50"]),
                fmt(upper["p50"]),
                fmt(upper["p95"]),
                fmt(upper["max"]),
                fmt(patch["p95"]),
                target,
                met,
            ]
        )
    write_csv(run_dir / "order_status_summary.csv", headers, rows)
    lines = [
        "## Order status latency",
        "",
        "Measured at the API: a buyer session polls `GET /orders/me/current` while "
        "the merchant updates the order. The upper bound starts when the PATCH is "
        "sent and the lower bound when its response arrives; the commit is between "
        "them. Measured on an idle server.",
        "",
    ] + table(headers, rows)

    webhook = read_csv(run_dir / "order_latency" / "webhook.csv")
    if webhook:
        good = [
            float(r["ms"])
            for r in webhook
            if r["http"] == "200" and r["settled"] == "1"
        ]
        summary = stats(good)
        failures = len(webhook) - len(good)
        write_target = P95_TARGET_MS["write"]
        met = verdict(
            summary["p95"], summary["n"], failures / len(webhook), write_target
        )
        verdicts.append(met)
        lines += ["", "### PayMongo webhook handler (signed replay)", ""]
        lines += table(
            ["n", "Failed", "p50 (ms)", "p95 (ms)", "Max (ms)", "Target (ms)", "Met?"],
            [
                [
                    len(webhook),
                    failures,
                    fmt(summary["p50"]),
                    fmt(summary["p95"]),
                    fmt(summary["max"]),
                    write_target,
                    met,
                ]
            ],
        )

    real_events = [
        r
        for path in run_dir.rglob("webhook_events.csv")
        for r in read_csv(path)
        if r["replay"] == "False" and r["event_created_ts"]
    ]
    if real_events:
        delays = [
            (float(r["received_ts"]) - float(r["event_created_ts"])) * 1000
            for r in real_events
        ]
        summary = stats(delays)
        lines += ["", "### PayMongo event to our server (real test payments)", ""]
        lines += [
            "PayMongo's created_at has 1 s resolution and comes from its clock, so "
            "treat this as approximate.",
            "",
        ]
        lines += table(
            ["n", "p50 (ms)", "p95 (ms)", "Max (ms)"],
            [
                [
                    summary["n"],
                    fmt(summary["p50"]),
                    fmt(summary["p95"]),
                    fmt(summary["max"]),
                ]
            ],
        )
    return lines, verdicts


def external_section(run_dir: Path, external):
    rows = [
        [
            f"`{name}`",
            users,
            *(
                fmt_fine(stats(values)[k]) if k != "n" else stats(values)["n"]
                for k in ("n", "p50", "p95", "max")
            ),
        ]
        for (name, users), values in sorted(external.items())
    ]
    if not rows:
        return []
    headers = ["Call", "Concurrency", "n", "p50 (ms)", "p95 (ms)", "Max (ms)"]
    write_csv(run_dir / "external_calls_summary.csv", headers, rows)
    return [
        "## Time inside third-party and solver calls",
        "",
        "Compare with the endpoint's total to attribute delay to the provider or to "
        "our code.",
        "",
    ] + table(headers, rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path)
    run_dir = parser.parse_args().run_dir

    manifest = json.loads((run_dir / "manifest.json").read_text())
    warmup = manifest["warmup_seconds"]
    stubs = {name for name in ("paymongo", "mapbox") if manifest[name] == "stub"}
    (
        client,
        server,
        queries,
        query_by_level,
        load,
        external,
        statements,
    ) = load_samples(run_dir, warmup)

    api_lines, api_verdicts = api_section(run_dir, client, load, manifest, stubs)
    db_lines, db_verdicts = db_section(run_dir, queries, query_by_level, statements)
    order_lines, order_verdicts = order_section(run_dir, stubs)
    verdicts = api_verdicts + db_verdicts + order_verdicts
    judged_yes = sum(v == "Yes" for v in verdicts)
    judged_no = sum(v == "No" or v.startswith("No (") for v in verdicts)
    not_judged = len(verdicts) - judged_yes - judged_no

    lines = ["# SOP 3 performance results", ""]
    if stubs:
        names = " and ".join(sorted(s.capitalize() for s in stubs))
        lines += [
            f"> **{names} stubbed.** Those calls were skipped, so these numbers are "
            "not end-to-end for the rows that depend on them, and those rows are not "
            "judged.",
            "",
        ]
    lines += [
        f"**{judged_yes} targets met, {judged_no} missed, {not_judged} not judged.**",
        "",
        f"Run {manifest['started_utc']} at commit `{manifest['git_commit'][:7]}` on "
        f"{manifest['machine']} ({manifest['cpu_count']} logical CPUs), PostgreSQL "
        f"{manifest['postgres_version']} on {manifest['database_host']}, "
        f"{manifest['server_workers']} uvicorn worker. "
        f"{manifest['duration_seconds']} s measured after {warmup} s warm-up, "
        f"{manifest['repeats']} repeat(s) pooled per level.",
    ]
    if manifest["git_dirty_files"]:
        lines += ["", f"Uncommitted files: {', '.join(manifest['git_dirty_files'])}."]
    lines += ["", *api_lines, "", *network_section(run_dir, client, server), ""]
    lines += [*db_lines, *queries_per_request(run_dir, warmup), ""]
    lines += [*order_lines, "", *external_section(run_dir, external), ""]

    (run_dir / "sop3_results.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"{judged_yes} met, {judged_no} missed, {not_judged} not judged.")


if __name__ == "__main__":
    main()
