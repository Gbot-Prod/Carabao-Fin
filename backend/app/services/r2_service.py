from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests as _http

_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID", "2c447e91e4400db3e917bfd7a89328a2")
_BUCKET = os.getenv("CLOUDFLARE_R2_BUCKET_NAME", "carabao-bucket")
_TOKEN = os.getenv("CARABAO_R2_TOKEN")
_PUBLIC_URL = os.getenv("CLOUDFLARE_R2_PUBLIC_URL", "").rstrip("/")

_EXT_MAP = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
}


def _ext(filename: str | None, content_type: str | None) -> str:
    if filename:
        s = Path(filename).suffix.lower()
        if s in {".png", ".jpg", ".jpeg", ".webp"}:
            return s
    return _EXT_MAP.get(content_type or "", ".bin")


def _put(key: str, data: bytes, content_type: str) -> str:
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{_ACCOUNT_ID}"
        f"/r2/buckets/{_BUCKET}/objects/{key}"
    )
    resp = _http.put(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {_TOKEN}",
            "Content-Type": content_type,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return f"{_PUBLIC_URL}/{key}"


def upload_banner(merchant_id: int, data: bytes, content_type: str, filename: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = f"merchants/{merchant_id}/banner/{ts}_{uuid.uuid4().hex}{_ext(filename, content_type)}"
    return _put(key, data, content_type)


def upload_produce_image(merchant_id: int, produce_id: int, data: bytes, content_type: str, filename: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = f"merchants/{merchant_id}/produce/{produce_id}/{ts}_{uuid.uuid4().hex}{_ext(filename, content_type)}"
    return _put(key, data, content_type)
