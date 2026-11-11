# SOP 3 performance tests

Measures API response time, database query time and order status latency, and
judges each against the thresholds in [targets.py](targets.py). Fix those thresholds
before collecting data.

## Safety

These scripts truncate and reseed their target database, so they refuse any database
whose name doesn't contain `perf`, or that matches `DATABASE_URL` in `.env`. By
default they use a throwaway local cluster. SMS and email are always off, and PayMongo
is forced into test mode.

## Run it

From `backend/`:

```bash
uv run python scripts/perf/perf_db.py start

# Everything real. Needs a network that can reach Mapbox. About 35 minutes.
uv run --group perf python scripts/perf/run_suite.py --paymongo real --mapbox real

uv run python scripts/perf/perf_db.py stop
```

Results go to `scripts/results/perf/<run>/`. Start with `sop3_results.md`.

To compare runs as clean CSVs for tabulating, with `00_table_index.csv` describing each:

```bash
uv run python scripts/perf/export_tables.py --out scripts/results/perf/<tables dir> \
    --run before_fix=scripts/results/perf/<older run> \
    --run after_fix=scripts/results/perf/<newer run>
```

| Flag | Default | Meaning |
|---|---|---|
| `--paymongo`, `--mapbox` | required | `real` calls the service. `stub` skips it, and rows that depend on it are marked "Not judged". |
| `--users` | `1,10,25,50` | Concurrency levels |
| `--warmup`, `--duration` | `30`, `120` | Seconds excluded, then seconds measured, per level |
| `--repeats` | `3` | Runs per level, pooled, with the p95 spread reported |
| `--trials` | `50` | Order status and webhook trials |

`--paymongo real` creates a test-mode checkout session for every simulated checkout,
about 1 per second per 10 healthy users, so check PayMongo's rate limits first. If it
rate-limits you, those failures appear as checkout errors, and it's PayMongo's limit
you measured. A sound alternative is real PayMongo at low concurrency (for example
`--users 1,10`) plus a separate `--paymongo stub` run at all levels.

## What each number means

**Load summary**: start here. Requests still stuck when a level ends are never
logged, so a stalled server appears as throughput falling as users rise, not as errors.

**Client side** (`client.csv`): what a user waits, from Locust. **Server side**
(`requests.csv`): the same requests timed inside the app. The difference is network
and queueing. **Queries** (`queries.csv`): every SQL statement, timed at the cursor;
this excludes waiting for a free connection, which shows up in request time instead.
**pg_stat_statements** and **EXPLAIN ANALYZE** give the database's own view.

**Order status latency** is measured at the API, on an idle server. See the
docstring in [order_latency.py](order_latency.py) for the bracket it reports.

## Limits to state in the paper

- **The web UI doesn't update status live.** `/orders` fetches once on page load, and
  `/track` fetches at most 5 times, 3 s apart, then stops. The 3000 ms row therefore
  shows the best case while the Track page is still polling. Otherwise a buyer sees
  a change on their next page load.
- **Local runs share one machine.** Server, database and load generator compete for
  the same CPU, and there is no network between them. To include the real network,
  deploy `instrumented_app:app` to a staging service with its own `carabao_perf`
  database, set `PERF_DATABASE_URL`, `PERF_RUN_DIR` and the `PERF_*` modes, and point
  Locust at it.
- **The schema comes from the models** (`create_all`), because the Alembic history
  can't build an empty database. Deployed indexes could differ.
- **The server runs one uvicorn worker.** Match this to your deployment.

## PayMongo webhook delay (manual)

The replayed webhook times the handler only. To measure PayMongo's own delivery delay:

1. Start the instrumented server (`PERF_PAYMONGO=real PERF_MAPBOX=stub
   PERF_RUN_DIR=<run>/webhook_e2e uv run python -m uvicorn instrumented_app:app
   --app-dir scripts/perf --port 8765`).
2. Expose it with a tunnel and register `<tunnel>/webhooks/paymongo` as a test-mode
   webhook. Put its secret in `PAYMONGO_WEBHOOK_SECRET`.
3. Make test payments through the returned checkout URLs.
4. Re-run `uv run python scripts/perf/analyze.py <run>`, which adds these events.
