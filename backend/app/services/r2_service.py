from __future__ import annotations

import os
import uuid
from urllib.parse import urlparse

import boto3
from botocore.config import Config

from app.services.upload_validation import CheckedFile

_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID", "2c447e91e4400db3e917bfd7a89328a2")
_BUCKET = os.getenv("CLOUDFLARE_R2_BUCKET_NAME", "carabao-bucket")
_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
_PUBLIC_URL = os.getenv("CLOUDFLARE_R2_PUBLIC_URL", "").rstrip("/")

# Identity documents go to a separate bucket that has no public URL. They are
# shown only through short-lived signed URLs (CF-0006).
_PRIVATE_BUCKET = os.getenv("CLOUDFLARE_R2_PRIVATE_BUCKET_NAME", "")
_SIGNED_URL_SECONDS = 60


def _client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=_ACCESS_KEY_ID,
        aws_secret_access_key=_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _new_key(prefix: str, extension: str) -> str:
    # The key is chosen by the server only; no part of it comes from the client.
    return f"{prefix}/{uuid.uuid4().hex}{extension}"


def _put_object(bucket: str, key: str, data: bytes, content_type: str) -> str:
    _client().put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key


def _put_public(prefix: str, file: CheckedFile) -> str:
    key = _new_key(prefix, file.extension)
    _put_object(_BUCKET, key, file.data, file.content_type)
    return f"{_PUBLIC_URL}/{key}"


def upload_shop_logo(merchant_id: int, file: CheckedFile) -> str:
    return _put_public(f"merchants/{merchant_id}/logo", file)


def upload_banner(merchant_id: int, file: CheckedFile) -> str:
    return _put_public(f"merchants/{merchant_id}/banner", file)


def upload_avatar(user_id: int, file: CheckedFile) -> str:
    return _put_public(f"users/{user_id}/avatar", file)


def upload_produce_image(merchant_id: int, produce_id: int, file: CheckedFile) -> str:
    return _put_public(f"merchants/{merchant_id}/produce/{produce_id}", file)


def _private_bucket() -> str:
    if not _PRIVATE_BUCKET or _PRIVATE_BUCKET == _BUCKET:
        # Fail closed: never put identity documents in the public bucket.
        raise RuntimeError(
            "CLOUDFLARE_R2_PRIVATE_BUCKET_NAME must name a private bucket"
        )
    return _PRIVATE_BUCKET


def _put_private(prefix: str, file: CheckedFile) -> str:
    """Store an identity document privately; return its object key (not a URL)."""
    key = _new_key(prefix, file.extension)
    return _put_object(_private_bucket(), key, file.data, file.content_type)


def upload_rsbsa_document(user_id: int, file: CheckedFile) -> str:
    return _put_private(f"rsbsa/{user_id}", file)


def upload_gov_id_document(user_id: int, file: CheckedFile) -> str:
    return _put_private(f"gov-id/{user_id}", file)


def upload_bir_cert_document(user_id: int, file: CheckedFile) -> str:
    """BIR Certificate of Registration (Form 2303)."""
    return _put_private(f"bir-2303/{user_id}", file)


def upload_selfie_document(user_id: int, file: CheckedFile) -> str:
    """Selfie with ID (a camera photo of the applicant holding the ID)."""
    return _put_private(f"selfie/{user_id}", file)


def delete_private_document(stored_path: str) -> None:
    """Remove a document that was uploaded for a submit that then failed."""
    _client().delete_object(Bucket=_private_bucket(), Key=_object_key(stored_path))


def get_private_document(stored_path: str) -> bytes:
    """A private document's bytes (the automated checks re-read them)."""
    response = _client().get_object(
        Bucket=_private_bucket(), Key=_object_key(stored_path)
    )
    return response["Body"].read()


def _object_key(stored_path: str) -> str:
    parsed = urlparse(stored_path)
    return (
        parsed.path.lstrip("/")
        if parsed.scheme and parsed.netloc
        else stored_path.lstrip("/")
    )


def create_private_document_url(
    stored_path: str,
    content_type: str | None = None,
) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": _private_bucket(),
            "Key": _object_key(stored_path),
            "ResponseContentDisposition": "inline",
            "ResponseContentType": content_type or "application/octet-stream",
        },
        ExpiresIn=_SIGNED_URL_SECONDS,
    )


# The RSBSA and government ID documents are in the same private bucket.
create_rsbsa_document_url = create_private_document_url
create_gov_id_document_url = create_private_document_url
