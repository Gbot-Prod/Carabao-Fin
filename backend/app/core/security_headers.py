"""CF-0068: security headers on every API response.

The web app sets its own in ``next.config.ts``; the API answered with none.
API responses carry personal data (orders, addresses, receipts, CSV exports),
so they must not be cached by a shared proxy or the browser, sniffed as HTML,
or framed by another site.

Pure ASGI middleware: it only adds headers the response does not already set,
so a route that chooses its own (for example a public, cacheable list) wins.
"""

from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

# A JSON API never needs to load anything or be framed. No
# Cross-Origin-Resource-Policy: the API and the web app may be on different
# sites (default Railway / Vercel domains), and CORS already governs fetches.
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"

ALWAYS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
)

# Swagger UI and ReDoc (development only, CF-0015) load scripts and styles.
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")

# Requests that identify a person: their answers are for that person only.
_AUTH_HEADERS = (b"authorization", b"x-internal-auth-sync-secret")


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        is_docs = path.startswith(DOCS_PATHS)
        request_headers = {k.lower() for k, _ in scope.get("headers", [])}
        personal = any(h in request_headers for h in _AUTH_HEADERS)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                extra = list(ALWAYS)
                if not is_docs:
                    extra.append((b"content-security-policy", API_CSP.encode()))
                if personal:
                    extra.append((b"cache-control", b"no-store"))
                headers.extend((k, v) for k, v in extra if k not in present)
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)
