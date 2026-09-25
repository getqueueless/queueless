import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import Settings

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    # frame-ancestors is its own CSP directive with its own default
    # (unrestricted) when omitted -- default-src 'none' does NOT cover it,
    # so it's named explicitly. X-Frame-Options above covers older browsers
    # that don't respect CSP's frame-ancestors.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
}


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        structlog.contextvars.bind_contextvars(request_id=request_id)
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.clear_contextvars()
        response.headers["x-request-id"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings):
        super().__init__(app)
        self.settings = settings

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        for key, value in SECURITY_HEADERS.items():
            response.headers[key] = value
        if request.url.path in ("/docs", "/openapi.json"):
            # Swagger UI needs its own CDN script/style; relax CSP only here.
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self' cdn.jsdelivr.net; "
                "style-src 'self' cdn.jsdelivr.net 'unsafe-inline'; img-src 'self' data:; "
                "frame-ancestors 'none'"
            )
        if self.settings.environment == "production":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response
