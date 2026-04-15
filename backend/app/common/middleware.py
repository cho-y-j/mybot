"""
ElectionPulse - Security Middleware
보안 헤더, 감사 로그, Rate Limiting
"""
import time
import uuid
from collections import defaultdict
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
import structlog

logger = structlog.get_logger()


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """보안 응답 헤더 자동 추가."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
        )
        return response


class AuditLogMiddleware(BaseHTTPMiddleware):
    """API 호출 감사 로그."""

    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        start = time.time()

        response = await call_next(request)

        duration_ms = round((time.time() - start) * 1000, 1)

        if request.url.path.startswith("/api/"):
            logger.info(
                "api_request",
                request_id=request_id,
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                duration_ms=duration_ms,
                ip=request.client.host if request.client else "unknown",
            )

        response.headers["X-Request-ID"] = request_id
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    IP 기반 Rate Limiting (인메모리).
    프로덕션에서는 Redis 기반으로 교체 권장.
    """

    def __init__(self, app, default_limit: int = 100, window_seconds: int = 60):
        super().__init__(app)
        self.default_limit = default_limit
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/api/"):
            return await call_next(request)

        # NPM(reverse proxy) 뒤에서는 request.client.host가 항상 프록시 IP(172.18.0.x)라
        # 모든 사용자가 같은 IP로 묶여 rate limit에 금방 걸림.
        # X-Forwarded-For / X-Real-IP 헤더에서 진짜 클라이언트 IP 추출.
        xff = request.headers.get("x-forwarded-for")
        if xff:
            client_ip = xff.split(",")[0].strip()
        else:
            client_ip = request.headers.get("x-real-ip") or (
                request.client.host if request.client else "unknown"
            )
        now = time.time()
        window_start = now - self.window_seconds

        # Determine rate limit based on endpoint
        limit = self.default_limit
        path = request.url.path
        if "/auth/login" in path:
            limit = 15  # 개발 중 여유 (배포 시 5로 축소)
        elif "/auth/register" in path:
            limit = 10

        # Clean old entries and count
        self._requests[client_ip] = [
            t for t in self._requests[client_ip] if t > window_start
        ]

        if len(self._requests[client_ip]) >= limit:
            logger.warning(
                "rate_limit_exceeded",
                ip=client_ip,
                path=path,
                limit=limit,
            )
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."},
                headers={"Retry-After": str(self.window_seconds)},
            )

        self._requests[client_ip].append(now)
        return await call_next(request)
