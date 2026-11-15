"""
main.app with SOP 3 timing added from outside, so production code is unchanged.

Writes to PERF_RUN_DIR:
  requests.csv        every HTTP request, timed inside the server
  queries.csv         every SQL statement (statements.csv maps ids to their text)
  external_calls.csv  every PayMongo, Mapbox and route-solver call
  webhook_events.csv  PayMongo webhooks, with the event's own created_at

PERF_PAYMONGO and PERF_MAPBOX are each "stub" (isolates our own code) or "real"
(PayMongo always in test mode). SMS and email are always off.

Run:  see run_suite.py, which starts this with uvicorn for each test level.
"""

import contextvars
import csv
import functools
import hashlib
import logging
import os
import queue
import re
import threading
import time
import uuid
from pathlib import Path

import common
from dotenv import load_dotenv

load_dotenv(common.BACKEND_ROOT / ".env")
common.use_perf_database()

PAYMONGO = os.getenv("PERF_PAYMONGO", "stub")
MAPBOX = os.getenv("PERF_MAPBOX", "stub")
if not {PAYMONGO, MAPBOX} <= {"stub", "real"}:
    raise SystemExit("PERF_PAYMONGO and PERF_MAPBOX must be 'stub' or 'real'.")

# Blank keys make any call a patch below missed fail instead of reaching a real
# service. load_dotenv doesn't override a variable that is already set.
os.environ["PAYMONGO_USE_TEST"] = "true"
os.environ["PAYMONGO_SECRET_KEY"] = ""
for key in ("SEMAPHORE_KEY", "UNISMS_API_SECRET_KEY", "RESEND_KEY"):
    os.environ[key] = ""
if PAYMONGO == "stub":
    os.environ["PAYMONGO_SECRET_TEST_KEY"] = ""
elif not os.getenv("PAYMONGO_SECRET_TEST_KEY"):
    raise SystemExit("PERF_PAYMONGO=real needs PAYMONGO_SECRET_TEST_KEY in .env.")
if MAPBOX == "stub":
    os.environ["MAPBOX_ACCESS_TOKEN"] = ""
# Tokens come from common.perf_token, not a running BetterAuth.
os.environ["BETTER_AUTH_URL"] = common.PERF_ISSUER
os.environ["BETTER_AUTH_JWT_AUDIENCE"] = common.PERF_AUDIENCE

from sqlalchemy import event  # noqa: E402

from app.api.routes import merchants, payments  # noqa: E402
from app.api.webhooks import paymongo as paymongo_webhook  # noqa: E402
from app.core import security  # noqa: E402
from app.core.database import engine  # noqa: E402
from app.services import order_reservations, sms_service  # noqa: E402
from main import app  # noqa: E402

_PERF_PUBLIC_KEY = common.perf_signing_key().public_key()
security._signing_key = lambda _token: _PERF_PUBLIC_KEY

logging.getLogger().setLevel(logging.WARNING)

COLUMNS = {
    "requests": ["wall_ts", "endpoint", "status", "ms"],
    "queries": ["wall_ts", "endpoint", "statement_id", "ms"],
    "statements": ["statement_id", "statement"],
    "external_calls": ["wall_ts", "endpoint", "name", "ms", "ok"],
    "webhook_events": [
        "received_ts",
        "event_created_ts",
        "session_id",
        "handler_ms",
        "replay",
    ],
}


class Recorder:
    """Writes rows on a background thread, so disk I/O stays out of the timings."""

    def __init__(self, run_dir: Path) -> None:
        run_dir.mkdir(parents=True, exist_ok=True)
        self._files = {
            name: (run_dir / f"{name}.csv").open("w", newline="", encoding="utf-8")
            for name in COLUMNS
        }
        self._writers = {name: csv.writer(f) for name, f in self._files.items()}
        for name, header in COLUMNS.items():
            self._writers[name].writerow(header)
        self._rows: queue.SimpleQueue = queue.SimpleQueue()
        threading.Thread(target=self._run, daemon=True).start()

    def record(self, name: str, *row: object) -> None:
        self._rows.put((name, row))

    def _run(self) -> None:
        # Flushes often: on Windows the suite stops the server with a hard kill.
        while True:
            try:
                name, row = self._rows.get(timeout=0.5)
                self._writers[name].writerow(row)
            except queue.Empty:
                for f in self._files.values():
                    f.flush()


recorder = Recorder(Path(os.environ["PERF_RUN_DIR"]))

# Holds the ASGI scope; the router adds the matched route to it during the request.
_request_scope: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "perf_request_scope", default=None
)


def endpoint_of(scope: dict | None) -> str:
    if scope is None:
        return "background"
    route = scope.get("route")
    path = route.path if route is not None else "unmatched"
    return f"{scope['method']} {path}"


class TimingMiddleware:
    def __init__(self, inner) -> None:
        self.inner = inner

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.inner(scope, receive, send)
            return

        status = 500
        start = time.perf_counter()

        async def capture_status(message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        token = _request_scope.set(scope)
        try:
            await self.inner(scope, receive, capture_status)
        finally:
            ms = (time.perf_counter() - start) * 1000
            recorder.record("requests", time.time(), endpoint_of(scope), status, ms)
            _request_scope.reset(token)


app.add_middleware(TimingMiddleware)

_statement_ids: dict[str, str] = {}
_statement_lock = threading.Lock()


def statement_id(statement: str) -> str:
    known = _statement_ids.get(statement)
    if known is not None:
        return known
    # IN (...) lists vary in length but are the same query.
    shape = re.sub(r"\bIN \([^)]*\)", "IN (...)", statement)
    digest = hashlib.sha1(shape.encode()).hexdigest()[:12]
    with _statement_lock:
        if statement not in _statement_ids:
            _statement_ids[statement] = digest
            recorder.record("statements", digest, " ".join(shape.split()))
    return digest


@event.listens_for(engine, "before_cursor_execute")
def _before_cursor(conn, cursor, statement, parameters, context, executemany):
    context._perf_start = time.perf_counter()


@event.listens_for(engine, "after_cursor_execute")
def _after_cursor(conn, cursor, statement, parameters, context, executemany):
    ms = (time.perf_counter() - context._perf_start) * 1000
    recorder.record(
        "queries",
        time.time(),
        endpoint_of(_request_scope.get()),
        statement_id(statement),
        ms,
    )


def timed(name: str, fn):
    """Wrap a function to record each call in external_calls.csv."""

    def log(start: float, ok: bool) -> None:
        ms = (time.perf_counter() - start) * 1000
        endpoint = endpoint_of(_request_scope.get())
        recorder.record("external_calls", time.time(), endpoint, name, ms, ok)

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        ok = False
        try:
            result = fn(*args, **kwargs)
            ok = result is not None
            return result
        finally:
            log(start, ok)

    return wrapper


def _stub_checkout(**_) -> dict:
    session_id = f"cs_perf_{uuid.uuid4().hex}"
    return {
        "id": session_id,
        "attributes": {"checkout_url": f"https://perf.invalid/{session_id}"},
    }


def _stub_retrieve(_session_id: str) -> dict:
    return {"attributes": {"status": "active", "payments": []}}


def _stub_geocode(address: str) -> tuple[float, float]:
    digest = hashlib.sha1(address.encode()).digest()
    return 14.55 + digest[0] / 2550, 120.95 + digest[1] / 2550


def _stub_leg_durations(coords: list) -> list[float]:
    return [600.0 * i for i in range(1, len(coords))]


if PAYMONGO == "stub":
    payments.create_checkout_session = _stub_checkout
    payments.retrieve_checkout_session = _stub_retrieve
    order_reservations.expire_checkout_session = lambda _session_id: True
if MAPBOX == "stub":
    merchants._geocode = _stub_geocode
    merchants._get_leg_durations = _stub_leg_durations

sms_service.send_sms = lambda **_: None

payments.create_checkout_session = timed(
    "paymongo.create_checkout_session", payments.create_checkout_session
)
order_reservations.expire_checkout_session = timed(
    "paymongo.expire_checkout_session", order_reservations.expire_checkout_session
)
merchants._geocode = timed("mapbox.geocode", merchants._geocode)
merchants._get_leg_durations = timed("mapbox.directions", merchants._get_leg_durations)
merchants.compute_route = timed("alns.compute_route", merchants.compute_route)

_handle_checkout_paid = paymongo_webhook._handle_checkout_paid


def _timed_handle_checkout_paid(payload: dict, db) -> None:
    received = time.time()
    start = time.perf_counter()
    try:
        _handle_checkout_paid(payload, db)
    finally:
        attributes = payload.get("data", {}).get("attributes", {})
        recorder.record(
            "webhook_events",
            received,
            attributes.get("created_at"),
            attributes.get("data", {}).get("id"),
            (time.perf_counter() - start) * 1000,
            bool(attributes.get("perf_replay")),
        )


paymongo_webhook._handle_checkout_paid = _timed_handle_checkout_paid
