"""CF-0022: refuse request bodies above a size limit before they are parsed.

Pure ASGI middleware. It checks Content-Length first, then counts the bytes
as they arrive, so a chunked or lying request is also stopped.
"""

from __future__ import annotations

import json

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MB = 1024 * 1024
DEFAULT_MAX_BODY = 12 * MB
# The RSBSA document and the government ID may be 20 MB each, the selfie with
# ID 10 MB; allow room for the form fields and boundaries.
PATH_LIMITS: dict[str, int] = {
    "/merchant-onboarding/me": 52 * MB,
}


def _detail(limit: int) -> str:
    return f"Request body must be under {limit // MB} MB"


class _BodyTooLarge(HTTPException):
    # An HTTPException, so FastAPI's body parser re-raises it as a 413
    # instead of turning it into "error parsing the body" (400).
    def __init__(self, limit: int) -> None:
        super().__init__(status_code=413, detail=_detail(limit))


class BodySizeLimitMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        default_limit: int = DEFAULT_MAX_BODY,
        path_limits: dict[str, int] | None = None,
    ) -> None:
        self.app = app
        self.default_limit = default_limit
        self.path_limits = PATH_LIMITS if path_limits is None else path_limits

    def _limit_for(self, path: str) -> int:
        return self.path_limits.get(path.rstrip("/") or "/", self.default_limit)

    @staticmethod
    async def _reject(send: Send, limit: int) -> None:
        body = json.dumps({"detail": _detail(limit)}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"connection", b"close"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self._limit_for(scope.get("path", ""))

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = -1
                if declared < 0 or declared > limit:
                    await self._reject(send, limit)
                    return
                break

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge(limit)
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if not response_started:
                await self._reject(send, limit)
