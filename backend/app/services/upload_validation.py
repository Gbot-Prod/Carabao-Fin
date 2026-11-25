"""Server-side checks for uploaded files (CF-0006).

The client-declared Content-Type and filename are never trusted:

- uploads are read in chunks and stopped at a size cap, so a large body is
  not held in memory;
- images are decoded and re-encoded with Pillow, which removes EXIF/GPS data
  and anything appended to the file, and gives the server-chosen type;
- PDFs must start with the PDF magic bytes, must parse, must not be
  encrypted, and must not contain JavaScript, launch actions or embedded files.
"""

from __future__ import annotations

import io
import re
import threading
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.errors import FieldErrors

MB = 1024 * 1024
IMAGE_MAX_BYTES = 5 * MB
DOCUMENT_MAX_BYTES = 20 * MB
SELFIE_MAX_BYTES = 10 * MB

_CHUNK = 64 * 1024
# A 5 MB file can decode to a very large bitmap; refuse those before decoding.
_MAX_PIXELS = 40_000_000
_MAX_SIDE = 4096

# CF-0025: set the Pillow bomb limit once, at import. warnings.catch_warnings()
# changes process-wide state and is not thread-safe, so it is not used. Pillow
# raises DecompressionBombError above 2x this value; the explicit check in
# reencode_image refuses anything above _MAX_PIXELS before load().
Image.MAX_IMAGE_PIXELS = _MAX_PIXELS

# Upload routes are sync (thread pool), so a threading semaphore is correct.
_DECODE_SLOTS = threading.BoundedSemaphore(2)

# Pillow format -> (content type, extension, save options)
_IMAGE_FORMATS: dict[str, tuple[str, str, dict[str, Any]]] = {
    "JPEG": ("image/jpeg", ".jpg", {"quality": 88, "optimize": True}),
    "PNG": ("image/png", ".png", {"optimize": True}),
    "WEBP": ("image/webp", ".webp", {"quality": 88}),
}

_PDF_MAGIC = b"%PDF-"
# PDF names that run code, open other files or carry files inside the PDF.
_PDF_BLOCKED_NAMES = {
    "/JS",
    "/JavaScript",
    "/EmbeddedFile",
    "/EmbeddedFiles",
    "/FileAttachment",
    "/GoToE",
    "/ImportData",
    "/Launch",
    "/RichMedia",
    "/XFA",
}
# Only long names here: a short name such as "/JS" can occur by chance in
# compressed image data. The object walk below finds the short names.
_PDF_BLOCKED_RAW = re.compile(
    rb"/(JavaScript|EmbeddedFiles?|FileAttachment|Launch|RichMedia)(?![A-Za-z0-9])"
)
_PDF_NAME_ESCAPE = re.compile(rb"#([0-9A-Fa-f]{2})")


@dataclass(frozen=True)
class CheckedFile:
    data: bytes
    content_type: str
    extension: str


def read_upload(upload: UploadFile, max_bytes: int, label: str) -> bytes:
    """Read the upload in chunks and stop as soon as it is over ``max_bytes``."""
    buf = bytearray()
    while True:
        chunk = upload.file.read(_CHUNK)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"{label} must be under {max_bytes // MB} MB",
            )
    if not buf:
        raise HTTPException(status_code=400, detail=f"{label} is empty")
    return bytes(buf)


def _bad_image(label: str) -> HTTPException:
    return HTTPException(status_code=400, detail=f"{label} must be PNG, JPEG, or WebP")


def reencode_image(data: bytes, label: str) -> CheckedFile:
    """Decode ``data`` as PNG/JPEG/WebP and return a clean re-encoded copy."""
    # CF-0025: decoding is CPU and memory heavy; cap how many run at once.
    with _DECODE_SLOTS:
        return _reencode_image(data, label)


def _reencode_image(data: bytes, label: str) -> CheckedFile:
    try:
        # Image.open reads only the header; pixels are decoded by load().
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format
            width, height = img.size
            if fmt not in _IMAGE_FORMATS:
                raise _bad_image(label)
            if width * height > _MAX_PIXELS:
                raise HTTPException(
                    status_code=400, detail=f"{label} dimensions are too large"
                )
            if fmt == "JPEG":
                # Let the JPEG decoder scale down (1/2, 1/4, 1/8) while it
                # decodes, so a large photo never decodes at full size.
                img.draft("RGB", (_MAX_SIDE, _MAX_SIDE))
            img.load()
            # Keep only the first frame; apply then drop the EXIF rotation.
            img.seek(0)
            out_img = ImageOps.exif_transpose(img)
            out_img.thumbnail((_MAX_SIDE, _MAX_SIDE))

            content_type, ext, options = _IMAGE_FORMATS[fmt]
            if fmt == "JPEG":
                out_img = out_img.convert("RGB")
            elif out_img.mode not in {"RGB", "RGBA", "L", "LA"}:
                out_img = out_img.convert("RGBA")

            out = io.BytesIO()
            # No exif/icc/info is passed, so metadata is not written.
            out_img.save(out, format=fmt, **options)
    except HTTPException:
        raise
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        OSError,
        ValueError,
        SyntaxError,
    ) as exc:
        raise _bad_image(label) from exc

    return CheckedFile(out.getvalue(), content_type, ext)


def _normalize_pdf_names(data: bytes) -> bytes:
    # "/J#61vaScript" is the same name as "/JavaScript".
    return _PDF_NAME_ESCAPE.sub(lambda m: bytes([int(m.group(1), 16)]), data)


def _walk_pdf_object(obj: Any, depth: int = 0) -> None:
    """Check one object and its direct children.

    Links to other objects (IndirectObject) are not followed: every indirect
    object is checked on its own from the cross-reference table.
    """
    from pypdf.generic import ArrayObject, DictionaryObject, NameObject

    if depth > 64:
        raise ValueError("PDF object nesting is too deep")
    if isinstance(obj, DictionaryObject):
        for key, value in obj.items():
            if key in _PDF_BLOCKED_NAMES:
                raise ValueError(f"blocked key {key}")
            if key in {"/S", "/Subtype", "/Type"} and isinstance(value, NameObject):
                if value in _PDF_BLOCKED_NAMES:
                    raise ValueError(f"blocked value {value}")
            _walk_pdf_object(value, depth + 1)
    elif isinstance(obj, ArrayObject):
        for item in obj:
            _walk_pdf_object(item, depth + 1)


def check_pdf(data: bytes, label: str) -> CheckedFile:
    """Accept a PDF only if it is a real, unencrypted PDF with no active content."""
    rejected = HTTPException(
        status_code=400,
        detail=f"{label} PDF is not accepted. Upload a plain scanned PDF or a photo.",
    )
    # The header may follow a little junk; PDF readers allow up to 1 KB.
    if _PDF_MAGIC not in data[:1024]:
        raise rejected

    # Quick scan of the raw bytes (catches uncompressed objects and names
    # written with #xx escapes).
    if _PDF_BLOCKED_RAW.search(_normalize_pdf_names(data)):
        raise rejected

    # Full scan: parse the file and walk every object, including those inside
    # compressed object streams that the raw scan cannot see.
    from pypdf import PdfReader
    from pypdf.generic import IndirectObject

    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            raise rejected
        _walk_pdf_object(reader.trailer)
        object_ids = {
            (idnum, gen) for gen, entries in reader.xref.items() for idnum in entries
        }
        object_ids.update((idnum, 0) for idnum in reader.xref_objStm)
        for idnum, gen in object_ids:
            _walk_pdf_object(IndirectObject(idnum, gen, reader).get_object())
        if len(reader.pages) == 0:
            raise rejected
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - any parse error means reject
        raise rejected from exc

    return CheckedFile(data, "application/pdf", ".pdf")


def check_image_upload(upload: UploadFile, label: str) -> CheckedFile:
    return reencode_image(read_upload(upload, IMAGE_MAX_BYTES, label), label)


def check_selfie_upload(upload: UploadFile, label: str) -> CheckedFile:
    """Selfie with ID: an image only, re-encoded (EXIF/GPS removed). A larger
    cap than other images: the mobile app sends the camera photo unresized."""
    return reencode_image(read_upload(upload, SELFIE_MAX_BYTES, label), label)


def check_document_upload(upload: UploadFile, label: str) -> CheckedFile:
    """An RSBSA document: a PDF (checked) or an image (re-encoded)."""
    data = read_upload(upload, DOCUMENT_MAX_BYTES, label)
    if _PDF_MAGIC in data[:1024]:
        return check_pdf(data, label)
    try:
        return reencode_image(data, label)
    except HTTPException as exc:
        if exc.status_code == 400:
            raise HTTPException(
                status_code=400, detail=f"{label} must be an image or PDF"
            ) from exc
        raise


def safe_filename(name: str | None, max_length: int = 120) -> str | None:
    """A display-only name: no path, no control characters, bounded length."""
    if not name:
        return None
    base = re.split(r"[\\/]", name)[-1]
    base = "".join(ch for ch in base if ch.isprintable()).strip()
    return base[:max_length] or None


# CF-0034: image URLs a client may send in a JSON body.
_IMAGE_URL_LABELS = {
    "image_url": "Photo",
    "banner_image_url": "Banner",
    "logo_url": "Logo",
}


def check_image_url_fields(
    requested: dict[str, Any], current: dict[str, str | None]
) -> None:
    """Allow a JSON body to keep or clear a stored image URL, never to set one.

    Stored image URLs are only written by the upload routes, after the file
    passed ``check_image_upload`` and went to our R2 bucket. Without this a
    merchant could PATCH any URL (a tracking pixel, an off-site or
    non-https link) onto a listing every buyer loads. Edit forms send the
    stored URL back unchanged, so an unchanged value and ``None``/``""``
    (remove the image) are accepted. Raises ``FieldErrors`` naming each field.
    """
    errors: dict[str, str] = {}
    for field, value in requested.items():
        if field not in _IMAGE_URL_LABELS or value in (None, ""):
            continue
        if value != current.get(field):
            label = _IMAGE_URL_LABELS[field]
            errors[field] = f"{label} can only be changed by uploading an image."
    if errors:
        raise FieldErrors(errors)


def blank_to_none(value: str | None) -> str | None:
    """``""`` from a cleared form field means no image."""
    return value or None
