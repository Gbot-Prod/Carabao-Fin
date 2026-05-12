from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.config import Config

_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID", "2c447e91e4400db3e917bfd7a89328a2")
_BUCKET = os.getenv("CLOUDFLARE_R2_BUCKET_NAME", "carabao-bucket")
_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
_PUBLIC_URL = os.getenv("CLOUDFLARE_R2_PUBLIC_URL", "").rstrip("/")

_EXT_MAP = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
}

_DOC_EXT_MAP = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
}


def _client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=_ACCESS_KEY_ID,
        aws_secret_access_key=_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _ext(filename: str | None, content_type: str | None) -> str:
    if filename:
        s = Path(filename).suffix.lower()
        if s in {".png", ".jpg", ".jpeg", ".webp"}:
            return s
    return _EXT_MAP.get(content_type or "", ".bin")


def _put(key: str, data: bytes, content_type: str) -> str:
    _client().put_object(
        Bucket=_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return f"{_PUBLIC_URL}/{key}"


def upload_shop_logo(merchant_id: int, data: bytes, content_type: str, filename: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = f"merchants/{merchant_id}/logo/{ts}_{uuid.uuid4().hex}{_ext(filename, content_type)}"
    return _put(key, data, content_type)


def upload_banner(merchant_id: int, data: bytes, content_type: str, filename: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = f"merchants/{merchant_id}/banner/{ts}_{uuid.uuid4().hex}{_ext(filename, content_type)}"
    return _put(key, data, content_type)


def upload_avatar(user_id: int, data: bytes, content_type: str, filename: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = f"users/{user_id}/avatar/{ts}_{uuid.uuid4().hex}{_ext(filename, content_type)}"
    return _put(key, data, content_type)


def upload_produce_image(merchant_id: int, produce_id: int, data: bytes, content_type: str, filename: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = f"merchants/{merchant_id}/produce/{produce_id}/{ts}_{uuid.uuid4().hex}{_ext(filename, content_type)}"
    return _put(key, data, content_type)


def _doc_ext(filename: str | None, content_type: str | None) -> str:
    if filename:
        s = Path(filename).suffix.lower()
        if s in {".pdf", ".png", ".jpg", ".jpeg", ".webp"}:
            return s
    return _DOC_EXT_MAP.get(content_type or "", ".bin")


def upload_rsbsa_document(user_id: int, data: bytes, content_type: str, filename: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = f"rsbsa/{user_id}/{ts}_{uuid.uuid4().hex}{_doc_ext(filename, content_type)}"
    return _put(key, data, content_type)
