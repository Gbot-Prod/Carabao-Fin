"""Web origins the API puts in links (documentation/manuals/SUBDOMAINS.md).

- ``APP_URL``: the buyer site (PayMongo return pages). Falls back to
  ``http://localhost:3000``.
- ``ADMIN_URL``: the admin site (2FA setup links). Falls back to ``APP_URL``,
  for a local setup that runs one web app only.

- ``MERCHANT_URL``: the merchant site (setup reminders). Falls back to
  ``APP_URL`` + ``/merchant``, where one local web app serves those pages.
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
        or "http://localhost:3000"
    )


def admin_url() -> str:
    return _origin(os.getenv("ADMIN_URL")) or app_url()


def merchant_url(path: str = "/") -> str:
    """A Merchant Centre page, e.g. merchant_url("/onboarding?step=business")."""
    origin = _origin(os.getenv("MERCHANT_URL"))
    base = origin if origin else f"{app_url()}/merchant"
    return f"{base}{path if path.startswith('/') else '/' + path}"
