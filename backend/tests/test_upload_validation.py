"""CF-0006: uploads are checked by content, not by the declared type."""

import io
import re

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image

from app.services import r2_service, upload_validation
from tests.files import (
    jpeg_with_exif,
    pdf_bytes,
    pdf_with_attachment,
    pdf_with_open_action_js,
    png_bytes,
)


def _upload(data: bytes, content_type: str = "image/png") -> UploadFile:
    return UploadFile(
        file=io.BytesIO(data),
        filename="x.png",
        headers={"content-type": content_type},
    )


def test_png_is_reencoded_with_server_type():
    checked = upload_validation.check_image_upload(_upload(png_bytes()), "Logo")
    assert checked.content_type == "image/png"
    assert checked.extension == ".png"
    assert Image.open(io.BytesIO(checked.data)).format == "PNG"


def test_declared_type_is_ignored():
    # A JPEG declared as PNG is stored as what it really is.
    checked = upload_validation.check_image_upload(
        _upload(jpeg_with_exif(), "image/png"), "Logo"
    )
    assert checked.content_type == "image/jpeg"


def test_exif_metadata_is_removed():
    checked = upload_validation.check_image_upload(_upload(jpeg_with_exif()), "Logo")
    assert b"SecretCam" not in checked.data
    assert not Image.open(io.BytesIO(checked.data)).getexif()


def test_appended_payload_is_removed():
    data = png_bytes() + b"<script>alert(1)</script>"
    checked = upload_validation.check_image_upload(_upload(data), "Logo")
    assert b"<script>" not in checked.data


@pytest.mark.parametrize(
    "data",
    [
        b"<html><script>alert(1)</script></html>",
        b"GIF89a" + b"\x00" * 64,
        pdf_bytes(),
    ],
)
def test_non_images_are_rejected(data):
    with pytest.raises(HTTPException) as exc:
        upload_validation.check_image_upload(_upload(data), "Logo")
    assert exc.value.status_code == 400


def test_size_cap_stops_reading(monkeypatch):
    monkeypatch.setattr(upload_validation, "IMAGE_MAX_BYTES", 1024)
    with pytest.raises(HTTPException) as exc:
        upload_validation.check_image_upload(_upload(b"x" * 10_000), "Logo")
    assert exc.value.status_code == 413


def test_huge_dimensions_are_rejected(monkeypatch):
    monkeypatch.setattr(upload_validation, "_MAX_PIXELS", 100)
    with pytest.raises(HTTPException) as exc:
        upload_validation.check_image_upload(_upload(png_bytes((20, 20))), "Logo")
    assert exc.value.status_code == 400


def test_plain_pdf_is_accepted():
    checked = upload_validation.check_document_upload(
        _upload(pdf_bytes(), "application/pdf"), "RSBSA document"
    )
    assert checked.content_type == "application/pdf"
    assert checked.extension == ".pdf"


def test_image_document_is_reencoded():
    checked = upload_validation.check_document_upload(
        _upload(png_bytes(), "application/pdf"), "RSBSA document"
    )
    assert checked.content_type == "image/png"


@pytest.mark.parametrize(
    "data",
    [
        pdf_bytes(javascript="app.alert(1)"),
        pdf_with_attachment(),
        pdf_with_open_action_js(),
        b"%PDF-1.4\n%%EOF",  # magic bytes only, not a real PDF
        b"%PDF-1.4\n1 0 obj << /S /J#61vaScript /JS (x) >> endobj",
    ],
)
def test_active_or_broken_pdfs_are_rejected(data):
    with pytest.raises(HTTPException) as exc:
        upload_validation.check_document_upload(
            _upload(data, "application/pdf"), "RSBSA document"
        )
    assert exc.value.status_code == 400


def test_text_disguised_as_pdf_is_rejected():
    with pytest.raises(HTTPException) as exc:
        upload_validation.check_document_upload(
            _upload(b"just text", "application/pdf"), "RSBSA document"
        )
    assert exc.value.status_code == 400


def test_safe_filename():
    assert upload_validation.safe_filename("../../etc/pass\x00wd") == "passwd"
    assert upload_validation.safe_filename("C:\\docs\\rsbsa.pdf") == "rsbsa.pdf"
    assert upload_validation.safe_filename("") is None
    assert len(upload_validation.safe_filename("a" * 500) or "") == 120


def test_public_key_is_random_and_type_is_server_set(monkeypatch):
    calls = []
    monkeypatch.setattr(r2_service, "_put_object", lambda *a: calls.append(a) or a[1])
    checked = upload_validation.reencode_image(png_bytes(), "Logo")
    url = r2_service.upload_shop_logo(7, checked)
    bucket, key, _data, content_type = calls[0]
    assert key.startswith("merchants/7/logo/") and key.endswith(".png")
    assert len(key.rsplit("/", 1)[1]) == len("0" * 32 + ".png")
    assert content_type == "image/png"
    assert url.endswith(key)


def test_rsbsa_document_needs_a_private_bucket(monkeypatch):
    monkeypatch.setattr(r2_service, "_PRIVATE_BUCKET", "")
    checked = upload_validation.check_pdf(pdf_bytes(), "RSBSA document")
    with pytest.raises(RuntimeError):
        r2_service.upload_rsbsa_document(1, checked)

    monkeypatch.setattr(r2_service, "_PRIVATE_BUCKET", r2_service._BUCKET)
    with pytest.raises(RuntimeError):
        r2_service.upload_rsbsa_document(1, checked)

    calls = []
    monkeypatch.setattr(r2_service, "_PRIVATE_BUCKET", "carabao-private")
    monkeypatch.setattr(r2_service, "_put_object", lambda *a: calls.append(a) or a[1])
    key = r2_service.upload_rsbsa_document(1, checked)
    assert calls[0][0] == "carabao-private"
    assert key.startswith("rsbsa/1/") and not key.startswith("http")


@pytest.mark.parametrize(
    "data",
    [
        pdf_bytes(javascript="app.alert(1)"),
        pdf_with_attachment(),
        pdf_with_open_action_js(),
    ],
)
def test_object_walk_finds_active_content_without_raw_scan(monkeypatch, data):
    # As if the names were hidden in a compressed object stream.
    monkeypatch.setattr(upload_validation, "_PDF_BLOCKED_RAW", re.compile(rb"(?!)"))
    with pytest.raises(HTTPException):
        upload_validation.check_pdf(data, "RSBSA document")
    # The same check passes a plain PDF.
    upload_validation.check_pdf(pdf_bytes(), "RSBSA document")
