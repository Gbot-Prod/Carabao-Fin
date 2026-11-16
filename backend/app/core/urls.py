"""Web origins the API puts in links (documentation/manuals/SUBDOMAINS.md).

- ``APP_URL``: the buyer site (PayMongo return pages). Falls back to the first
  entry of ``FRONTEND_URL``, then ``http://localhost:3000``.
- ``ADMIN_URL``: the admin site (2FA setup links). Falls back to ``APP_URL``,
  for a local setup that runs one web app only.

The merchant site makes no links from the API yet, so it has no setting here.
Values are read on each call, so a test or a restart picks up a change.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse


def _origin(value: str | None) -> str | None:
    if not value:
        return None
    value = value.split(",")[0].strip().strip('"').rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def app_url() -> str:
    return (
        _origin(os.getenv("APP_URL"))
        or _origin(os.getenv("FRONTEND_URL"))
        or "http://localhost:3000"
    )


def admin_url() -> str:
    return _origin(os.getenv("ADMIN_URL")) or app_url()
