"""Checks on a listing photo (produce guardrails Phase 4).

Run on the re-encoded upload (``upload_validation.reencode_image``), before
the photo goes to R2:

* **QR code (hard block).** A QR code on a produce photo is almost always a
  GCash, Maya or Facebook link, so the upload is refused.
* **Perceptual hash.** A 64-bit pHash is saved on the listing
  (``produces.image_phash``). The checker compares it with the photos of other
  farms' listings: a near match is a soft flag (``POSSIBLE_STOLEN_PHOTO``).

There is no local OCR (Tesseract needs a system binary). The vision check
(``listing_vision``) reads text in the photo.
"""

from __future__ import annotations

import io
import threading
from dataclasses import dataclass

import numpy as np
import zxingcpp
from PIL import Image

from app.core.errors import FieldErrors

# A larger distance also finds crops and edits, but gives more false flags on
# plain photos (tomatoes on a white table). 6 of 64 bits.
PHASH_MAX_DISTANCE = 6
_HASH_SIZE = 8
_DCT_SIZE = 32
# QR codes are found on a copy no larger than this; small codes stay readable.
_QR_MAX_SIDE = 1600

QR_CODE_MESSAGE = (
    "Remove the QR code from the photo. Buyers pay through Carabao checkout "
    "and contact you through Carabao chat only."
)

_QR_FORMATS = zxingcpp.BarcodeFormats(
    [
        zxingcpp.BarcodeFormat.QRCode,
        zxingcpp.BarcodeFormat.MicroQRCode,
        zxingcpp.BarcodeFormat.RMQRCode,
    ]
)
# Decoding is CPU heavy, as in upload_validation.
_SLOTS = threading.BoundedSemaphore(2)


@dataclass(frozen=True)
class PhotoFacts:
    phash: int  # signed 64-bit, as Postgres BIGINT stores it
    has_qr_code: bool


def _dct_matrix(n: int) -> np.ndarray:
    k = np.arange(n).reshape(-1, 1)
    i = np.arange(n).reshape(1, -1)
    matrix: np.ndarray = np.cos(np.pi * (2 * i + 1) * k / (2 * n)) * np.sqrt(2 / n)
    matrix[0, :] = np.sqrt(1 / n)
    return matrix


_DCT = _dct_matrix(_DCT_SIZE)


def _to_signed(value: int) -> int:
    return value - (1 << 64) if value >= 1 << 63 else value


def phash(image: Image.Image) -> int:
    """The 64-bit perceptual hash of ``image`` (signed, for a BIGINT column).

    Grayscale 32x32, a 2D DCT, then one bit per low-frequency coefficient:
    above or below the median of the 8x8 block (the DC term is not used for
    the median, because it only gives the mean brightness).
    """
    small = image.convert("L").resize((_DCT_SIZE, _DCT_SIZE), Image.Resampling.LANCZOS)
    pixels = np.asarray(small, dtype=np.float64)
    block = (_DCT @ pixels @ _DCT.T)[:_HASH_SIZE, :_HASH_SIZE]
    median = np.median(block.flatten()[1:])
    value = 0
    for bit in (block > median).flatten():
        value = (value << 1) | int(bit)
    return _to_signed(value)


def distance(a: int, b: int) -> int:
    """How many of the 64 bits are different."""
    return ((a ^ b) & ((1 << 64) - 1)).bit_count()


def has_qr_code(image: Image.Image) -> bool:
    gray = image.convert("L")
    if max(gray.size) > _QR_MAX_SIDE:
        gray.thumbnail((_QR_MAX_SIDE, _QR_MAX_SIDE))
    return bool(zxingcpp.read_barcodes(gray, formats=_QR_FORMATS))


def inspect(data: bytes) -> PhotoFacts:
    """The facts about one re-encoded photo (PNG, JPEG or WebP bytes)."""
    with _SLOTS, Image.open(io.BytesIO(data)) as img:
        img.load()
        return PhotoFacts(phash=phash(img), has_qr_code=has_qr_code(img))


def refuse_qr_code(facts: PhotoFacts) -> None:
    """Hard block: 400 ``FieldErrors`` on ``image`` when the photo has a QR code."""
    if facts.has_qr_code:
        raise FieldErrors({"image": QR_CODE_MESSAGE})
