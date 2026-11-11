"""
Throwaway local PostgreSQL cluster for the SOP 3 tests, with pg_stat_statements.

Uses the installed PostgreSQL binaries but its own data directory and port, so it
needs no password and doesn't touch the installed service. The data directory sits
outside OneDrive because file syncing would distort disk timings.

Run:  uv run python scripts/perf/perf_db.py start | stop | status | drop
"""

import argparse
import glob
import os
import shutil
import subprocess
import sys
from pathlib import Path

from common import LOCAL_PERF_PORT

DB_NAME = "carabao_perf"
CLUSTER_DIR = Path(os.getenv("LOCALAPPDATA", Path.home())) / "carabao-perf"
DATA_DIR = CLUSTER_DIR / "pgdata"

CONFIG = f"""
port = {LOCAL_PERF_PORT}
listen_addresses = '127.0.0.1'
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
"""


def pg_binary(name: str) -> str:
    if found := shutil.which(name):
        return found
    matches = sorted(glob.glob(rf"C:\Program Files\PostgreSQL\*\bin\{name}.exe"))
    if not matches:
        raise SystemExit(f"Could not find {name}; add PostgreSQL's bin to PATH.")
    return matches[-1]


def is_running() -> bool:
    result = subprocess.run(
        [pg_binary("pg_ctl"), "status", "-D", str(DATA_DIR)],
        capture_output=True,
    )
    return result.returncode == 0


def start() -> None:
    if not (DATA_DIR / "PG_VERSION").exists():
        CLUSTER_DIR.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                pg_binary("initdb"),
                "-D",
                str(DATA_DIR),
                "-U",
                "postgres",
                "-A",
                "trust",
                "-E",
                "UTF8",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        with (DATA_DIR / "postgresql.conf").open("a") as conf:
            conf.write(CONFIG)

    if not is_running():
        # Output goes to DEVNULL: the server inherits these handles and a captured
        # pipe would never close.
        subprocess.run(
            [
                pg_binary("pg_ctl"),
                "start",
                "-w",
                "-D",
                str(DATA_DIR),
                "-l",
                str(CLUSTER_DIR / "server.log"),
            ],
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    import psycopg

    admin = f"postgresql://postgres@127.0.0.1:{LOCAL_PERF_PORT}"
    with psycopg.connect(f"{admin}/postgres", autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (DB_NAME,)
        ).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{DB_NAME}"')
    with psycopg.connect(f"{admin}/{DB_NAME}", autocommit=True) as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")
    print(f"Perf database ready on 127.0.0.1:{LOCAL_PERF_PORT}/{DB_NAME}")


def stop() -> None:
    if is_running():
        subprocess.run(
            [pg_binary("pg_ctl"), "stop", "-w", "-m", "fast", "-D", str(DATA_DIR)],
            check=True,
            stdout=subprocess.DEVNULL,
        )
    print("Perf database stopped.")


def drop() -> None:
    stop()
    shutil.rmtree(CLUSTER_DIR, ignore_errors=True)
    print(f"Removed {CLUSTER_DIR}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["start", "stop", "status", "drop"])
    command = parser.parse_args().command
    if command == "status":
        print("running" if is_running() else "stopped")
        sys.exit(0)
    {"start": start, "stop": stop, "drop": drop}[command]()


if __name__ == "__main__":
    main()
