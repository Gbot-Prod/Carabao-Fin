"""Generic client errors tied to a request ID (CF-0013).

Clients get a short, generic message that ends with a reference. The full
upstream error (PayMongo, Semaphore, R2, Resend, ...) is logged on the server
under the same ID, so support can find it from the reference alone.

The ID comes from the request ID middleware in main.py, which also returns it
in the ``X-Request-ID`` response header.
"""

from __future__ import annotations

import logging
import re
import uuid
from contextvars import ContextVar

from fastapi import HTTPException, Request, Response

logger = logging.getLogger("app.errors")

REQUEST_ID_HEADER = "X-Request-ID"
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
# Accept a caller's ID only if it is short and plain, so it is safe in logs.
_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def new_request_id() -> str:
    return uuid.uuid4().hex[:16]


def request_id_from_header(value: str | None) -> str:
    """The caller's ID if it is safe to use, else a new one."""
    if value and _SAFE_ID.fullmatch(value):
        return value
    return new_request_id()


def set_request_id(request_id: str):
    return _request_id.set(request_id)


def reset_request_id(token) -> None:
    _request_id.reset(token)


def current_request_id() -> str:
    """The ID of the request in progress (a new one outside a request)."""
    request_id = _request_id.get()
    if request_id is None:
        request_id = new_request_id()
        _request_id.set(request_id)
    return request_id


def with_reference(message: str, request_id: str) -> str:
    return f"{message} (reference: {request_id})"


def describe_error(exc: BaseException) -> str:
    """CF-0071: a log-safe description of an outside service's error.

    The type only: email and SMS provider errors can repeat the recipient,
    the message (a code or a setup link) or a key. ``SemaphoreError`` texts
    are built without values (integrations/sms/semaphore.py), so they are kept.
    """
    from app.integrations.sms.semaphore import SemaphoreError

    if isinstance(exc, SemaphoreError):
        return f"SemaphoreError: {exc}"
    return type(exc).__name__


def upstream_error(
    status_code: int,
    message: str,
    *,
    log: str,
    exc: BaseException | None = None,
) -> HTTPException:
    """Log ``log`` (and ``exc``) under the request ID; return a generic error.

    Use as ``raise upstream_error(...) from exc``. ``message`` goes to the
    client and must not contain upstream text.
    """
    request_id = current_request_id()
    logger.error(
        "[request_id=%s] %s",
        request_id,
        log,
        exc_info=(type(exc), exc, exc.__traceback__) if exc is not None else None,
    )
    return HTTPException(
        status_code=status_code,
        detail=with_reference(message, request_id),
        headers={REQUEST_ID_HEADER: request_id},
    )


class FieldErrors(HTTPException):
    """A refusal that names the form fields at fault (site standard).

    The response is ``{"detail": "<all messages>", "errors": {field: message}}``
    so the client can mark each field and show its message under it. Without
    ``field_errors_handler`` registered it is still a plain HTTPException with
    a readable ``detail``.
    """

    def __init__(self, errors: dict[str, str], status_code: int = 400) -> None:
        self.errors = errors
        super().__init__(status_code=status_code, detail=" ".join(errors.values()))


async def field_errors_handler(_request: Request, exc: Exception) -> Response:
    from fastapi.responses import JSONResponse

    # Registered for FieldErrors only; typed Exception to fit Starlette.
    assert isinstance(exc, FieldErrors)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "errors": exc.errors},
        headers=exc.headers,
    )
