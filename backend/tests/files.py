"""Small valid upload files for tests."""

import io

from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import (
    ArrayObject,
    DictionaryObject,
    NameObject,
    TextStringObject,
)


def png_bytes(size: tuple[int, int] = (8, 8)) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", size, (10, 200, 30, 255)).save(out, format="PNG")
    return out.getvalue()


def jpeg_with_exif() -> bytes:
    img = Image.new("RGB", (8, 8), (200, 10, 10))
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"  # Make
    out = io.BytesIO()
    img.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def pdf_bytes(javascript: str | None = None) -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    if javascript is not None:
        # A document-level script in the /Names /JavaScript tree.
        js = writer._add_object(
            DictionaryObject(
                {
                    NameObject("/S"): NameObject("/JavaScript"),
                    NameObject("/JS"): TextStringObject(javascript),
                }
            )
        )
        tree = DictionaryObject(
            {NameObject("/Names"): ArrayObject([TextStringObject("a"), js])}
        )
        writer._root_object[NameObject("/Names")] = DictionaryObject(
            {NameObject("/JavaScript"): writer._add_object(tree)}
        )
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def pdf_with_attachment() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_attachment("payload.exe", b"MZ...")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def pdf_with_open_action_js() -> bytes:
    """JavaScript in a compressed object stream, with the name hex-escaped."""
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    action = DictionaryObject(
        {
            NameObject("/S"): NameObject("/JavaScript"),
            NameObject("/JS"): TextStringObject("app.alert(1)"),
        }
    )
    writer._root_object[NameObject("/OpenAction")] = writer._add_object(action)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
