"""Postgres URL + TLS settings for SQLAlchemy (psycopg 3 / libpq).

Same env vars as frontend/carabao-app/lib/db-ssl.mjs:
  PGSSL_CA          PEM of the CA that signed the server cert. Literal "\\n"
                    escapes are accepted. libpq needs a file, so the PEM is
                    written to a private temp file. Without it, the system
                    trust store is used (sslrootcert=system).
  PGSSL_SERVERNAME  Name the cert must carry, when it is not the host in the
                    URL. Railway's TCP proxy serves a cert for "localhost"
                    signed by a per-database "root-ca". libpq checks the cert
                    against `host`, so `host` becomes this name and the real
                    proxy address goes in `hostaddr` (resolved on each connect).
The server cert is always verified (sslmode=verify-full).
A database on localhost / 127.0.0.1 / ::1 connects without TLS (local dev).
"""

import hashlib
import os
import socket
import tempfile
from collections.abc import Mapping
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def normalize_database_url(url: str) -> str:
    """Use the installed psycopg 3 driver for PostgreSQL URLs."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("postgresql+psycopg2://"):
        return "postgresql+psycopg://" + url[len("postgresql+psycopg2://") :]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


def _ca_file(env: Mapping[str, str]) -> str | None:
    raw = (env.get("PGSSL_CA") or "").strip().strip('"')
    if not raw:
        return None
    pem = raw.replace("\\n", "\n")
    if "-----BEGIN CERTIFICATE-----" not in pem:
        raise RuntimeError("PGSSL_CA must be a PEM certificate (-----BEGIN CERTIFICATE-----).")
    digest = hashlib.sha256(pem.encode()).hexdigest()[:16]
    path = os.path.join(tempfile.gettempdir(), f"carabao-pg-ca-{digest}.pem")
    if not os.path.exists(path):
        fd, tmp = tempfile.mkstemp(dir=tempfile.gettempdir(), suffix=".pem")
        with os.fdopen(fd, "w") as fh:
            fh.write(pem)
        os.replace(tmp, path)
    return path


def create_db_engine(url: str, env: Mapping[str, str] | None = None, **kwargs: Any) -> Engine:
    """create_engine() with verified TLS for any non-local Postgres host.

    CF-0074: ``hide_parameters`` by default, so a database error's text (and
    every log or traceback that prints it) shows the SQL without its values:
    those are emails, phone numbers, names and addresses.
    """
    env = os.environ if env is None else env
    kwargs.setdefault("hide_parameters", True)
    sa_url = make_url(normalize_database_url(url))
    if sa_url.get_backend_name() != "postgresql":
        return create_engine(sa_url, **kwargs)

    host = sa_url.host or ""
    if host in LOCAL_HOSTS:
        return create_engine(sa_url, **kwargs)

    # Drop TLS options from the URL so this function owns them.
    query = {k: v for k, v in sa_url.query.items() if not k.startswith("ssl")}
    sa_url = sa_url.set(query=query)

    connect_args = dict(kwargs.pop("connect_args", {}))
    connect_args["sslmode"] = "verify-full"
    connect_args["sslrootcert"] = _ca_file(env) or "system"

    servername = (env.get("PGSSL_SERVERNAME") or "").strip()
    engine = create_engine(sa_url, connect_args=connect_args, **kwargs)

    if servername and servername != host:
        port = sa_url.port or 5432

        @event.listens_for(engine, "do_connect")
        def _pin_cert_name(dialect, conn_rec, cargs, cparams):  # noqa: ARG001
            cparams["hostaddr"] = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)[0][4][0]
            cparams["host"] = servername

    return engine
