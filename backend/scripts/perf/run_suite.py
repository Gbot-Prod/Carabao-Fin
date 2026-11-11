"""
Run the whole SOP 3 data collection and write results/perf/<run>/sop3_results.md.

Each concurrency level gets a freshly seeded database and a fresh server, so levels
don't affect each other. The order-status, webhook and EXPLAIN measurements run
last, on an idle server.

Run:  uv run --group perf python scripts/perf/run_suite.py --paymongo real --mapbox real
"""

import argparse
import csv
import json
import math
import os
import platform
import re
import subprocess
import sys
import time
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

import common
import requests
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

HERE = Path(__file__).resolve().parent


def git_output(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=common.BACKEND_ROOT, capture_output=True, text=True
    )
    return result.stdout.strip()


def run_script(name: str, *args: str, check: bool = True) -> int:
    command = [sys.executable, str(HERE / name), *args]
    return subprocess.run(command, check=check).returncode


def require_reachable(name: str, url: str) -> None:
    """Fail now rather than an hour in. Any HTTP response counts as reachable."""
    try:
        requests.get(url, timeout=10)
    except requests.RequestException:
        raise SystemExit(
            f"{name} isn't reachable from this network. Use another network or "
            f"--{name.lower()} stub, which leaves the rows that depend on it unjudged."
        ) from None


class Server:
    """The instrumented app in its own process, writing to run_dir."""

    def __init__(self, run_dir: Path, args: argparse.Namespace) -> None:
        self.run_dir = run_dir
        self.args = args
        self.port = args.port
        self.base_url = f"http://127.0.0.1:{self.port}"

    def __enter__(self) -> "Server":
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.log = (self.run_dir / "server.log").open("w")
        self.process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "instrumented_app:app",
                "--app-dir",
                str(HERE),
                "--host",
                "127.0.0.1",
                "--port",
                str(self.port),
                "--no-access-log",
                "--log-level",
                "warning",
            ],
            cwd=common.BACKEND_ROOT,
            env={
                **os.environ,
                "PERF_RUN_DIR": str(self.run_dir),
                "PERF_PAYMONGO": self.args.paymongo,
                "PERF_MAPBOX": self.args.mapbox,
            },
            stdout=self.log,
            stderr=subprocess.STDOUT,
        )
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise SystemExit(f"Server exited; see {self.run_dir / 'server.log'}")
            try:
                requests.get(f"{self.base_url}/openapi.json", timeout=2)
                return self
            except requests.RequestException:
                time.sleep(0.5)
        self.process.kill()
        raise SystemExit("Server did not start within 60 s.")

    def __exit__(self, *_) -> None:
        # Let the recorder's periodic flush catch the last rows before the kill.
        time.sleep(2)
        self.process.kill()
        self.process.wait()
        self.log.close()
        # The geocoder prints its request URL when Mapbox fails, token included.
        path = self.run_dir / "server.log"
        log = path.read_text(encoding="utf-8", errors="replace")
        path.write_text(
            re.sub(r"access_token=[^\s&'\")]+", "access_token=REDACTED", log),
            encoding="utf-8",
        )


def reset_pg_stats(engine) -> bool:
    try:
        with engine.begin() as conn:
            conn.execute(text("SELECT pg_stat_statements_reset()"))
        return True
    except Exception as exc:
        print(f"pg_stat_statements unavailable, skipping it: {exc}")
        return False


def snapshot_pg_stats(engine, path: Path) -> None:
    with engine.connect() as conn:
        result = conn.execute(
            text(
                """
                SELECT query, calls, mean_exec_time, max_exec_time, total_exec_time,
                       rows, shared_blks_hit, shared_blks_read
                FROM pg_stat_statements
                WHERE dbid = (SELECT oid FROM pg_database
                              WHERE datname = current_database())
                ORDER BY total_exec_time DESC
                """
            )
        )
        with path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(result.keys())
            writer.writerows(result)


def run_level(args, engine, run_dir: Path, users: int, repeat: int) -> None:
    level_dir = run_dir / f"users_{users:03d}_rep{repeat}"
    print(f"--- {users} users, repeat {repeat} ---", flush=True)
    run_script("seed.py")
    with Server(level_dir, args) as server:
        has_stats = reset_pg_stats(engine)
        subprocess.run(
            [
                sys.executable,
                "-m",
                "locust",
                "-f",
                str(HERE / "locustfile.py"),
                "--headless",
                "--users",
                str(users),
                "--spawn-rate",
                str(math.ceil(users / 10)),
                "--run-time",
                f"{args.warmup + args.duration}s",
                "--stop-timeout",
                "10",
                "--host",
                server.base_url,
                "--only-summary",
                "--csv",
                str(level_dir / "locust"),
            ],
            env={**os.environ, "PERF_CLIENT_CSV": str(level_dir / "client.csv")},
            # Locust exits 1 when any request failed; analysis reports those.
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=(level_dir / "locust.log").open("w"),
        )
        if has_stats:
            snapshot_pg_stats(engine, level_dir / "pg_stat_statements.csv")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--users", default="1,10,25,50")
    parser.add_argument("--warmup", type=int, default=30, help="Seconds excluded")
    parser.add_argument("--duration", type=int, default=120, help="Seconds measured")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--trials", type=int, default=50)
    parser.add_argument("--paymongo", choices=["stub", "real"], required=True)
    parser.add_argument("--mapbox", choices=["stub", "real"], required=True)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--label", default="")
    args = parser.parse_args()

    if args.paymongo == "real":
        require_reachable("PayMongo", "https://api.paymongo.com/v1")
    if args.mapbox == "real":
        require_reachable("Mapbox", "https://api.mapbox.com/")

    os.environ["PERF_DATABASE_URL"] = common.perf_database_url()
    engine = create_engine(os.environ["PERF_DATABASE_URL"])

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    suffix = f"_{args.label}" if args.label else ""
    modes = f"paymongo-{args.paymongo}_mapbox-{args.mapbox}"
    run_dir = common.RESULTS_ROOT / f"{stamp}_{modes}{suffix}"
    run_dir.mkdir(parents=True)

    db_url = make_url(os.environ["PERF_DATABASE_URL"])
    with engine.connect() as conn:
        pg_version = conn.execute(text("SHOW server_version")).scalar_one()
    manifest = {
        "started_utc": stamp,
        "paymongo": args.paymongo,
        "mapbox": args.mapbox,
        "users": [int(u) for u in args.users.split(",")],
        "warmup_seconds": args.warmup,
        "duration_seconds": args.duration,
        "repeats": args.repeats,
        "order_trials": args.trials,
        "git_commit": git_output("rev-parse", "HEAD"),
        "git_dirty_files": git_output("status", "--porcelain").splitlines(),
        "database_host": db_url.host,
        "database_name": db_url.database,
        "postgres_version": pg_version,
        "machine": platform.platform(),
        "cpu_count": os.cpu_count(),
        "python": platform.python_version(),
        "locust": version("locust"),
        "fastapi": version("fastapi"),
        "server_workers": 1,
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    for repeat in range(1, args.repeats + 1):
        for users in manifest["users"]:
            run_level(args, engine, run_dir, users, repeat)

    print("--- order status and webhook ---", flush=True)
    run_script("seed.py")
    latency_dir = run_dir / "order_latency"
    with Server(latency_dir, args) as server:
        # A failure here shouldn't discard the load-test levels already collected.
        code = run_script(
            "order_latency.py",
            "--host",
            server.base_url,
            "--out",
            str(latency_dir),
            "--trials",
            str(args.trials),
            check=False,
        )
    if code:
        print("WARNING: order latency stopped early; its tables will be partial.")

    print("--- EXPLAIN ANALYZE ---", flush=True)
    run_script("seed.py")
    run_script("db_explain.py", "--out", str(run_dir))

    run_script("analyze.py", str(run_dir))
    print(f"\nResults: {run_dir / 'sop3_results.md'}")


if __name__ == "__main__":
    main()
