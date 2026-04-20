"""
ElectionPulse - Main FastAPI Application
선거 분석 SaaS 플랫폼 메인 엔트리포인트
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.config import get_settings
from app.database import init_db, close_db
from app.auth.router import router as auth_router
from app.tenants.router import router as tenants_router
from app.elections.router import router as elections_router
from app.collectors.router import router as collectors_router
from app.analysis.router import router as analysis_router
from app.reports.router import router as reports_router
from app.telegram_service.router import router as telegram_router
from app.email_service.router import router as email_router
from app.admin.router import router as admin_router
from app.billing.router import router as billing_router
from app.elections.onboarding import router as onboarding_router
from app.chat.router import router as chat_router
from app.content.router import router as content_router
from app.services.easy_router import router as easy_router
from app.elections.history_router import router as history_router
from app.elections.events_router import router as events_router
from app.elections.survey_router import router as survey_router
from app.strategy.router import router as strategy_router
from app.homepage_sso.router import router as homepage_sso_router
from app.common.middleware import (
    RateLimitMiddleware,
    AuditLogMiddleware,
    SecurityHeadersMiddleware,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup & shutdown events."""
    # Startup
    from app.init_app import create_tables, create_superadmin
    await create_tables()
    await create_superadmin()
    yield
    # Shutdown
    await close_db()


app = FastAPI(
    title="ElectionPulse API",
    description="선거 분석 SaaS 플랫폼 - 실시간 여론/미디어 분석",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.APP_DEBUG else None,
    redoc_url="/api/redoc" if settings.APP_DEBUG else None,
)

# ──────────────── Middleware (order matters: last added = first executed) ────
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(AuditLogMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3100",
        f"https://{settings.APP_DOMAIN}",
        f"https://admin.{settings.APP_DOMAIN}",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)
if settings.is_production:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=[settings.APP_DOMAIN, f"*.{settings.APP_DOMAIN}"],
    )

# ──────────────── Routers ──────────────────────────────────────────────────
app.include_router(auth_router, prefix="/api/auth", tags=["Authentication"])
app.include_router(tenants_router, prefix="/api/tenants", tags=["Tenants"])
app.include_router(elections_router, prefix="/api/elections", tags=["Elections"])
app.include_router(collectors_router, prefix="/api/collectors", tags=["Data Collection"])
app.include_router(analysis_router, prefix="/api/analysis", tags=["Analysis"])
app.include_router(reports_router, prefix="/api/reports", tags=["Reports"])
app.include_router(telegram_router, prefix="/api/telegram", tags=["Telegram"])
app.include_router(email_router, prefix="/api/email", tags=["Email"])
app.include_router(admin_router, prefix="/api/admin", tags=["Admin"])
app.include_router(billing_router, prefix="/api/billing", tags=["Billing"])
app.include_router(onboarding_router, prefix="/api/onboarding", tags=["Smart Onboarding"])
app.include_router(chat_router, prefix="/api/chat", tags=["AI Chat"])
app.include_router(content_router, prefix="/api/content", tags=["Content Tools"])
app.include_router(easy_router, prefix="/api/easy", tags=["Easy Mode"])
app.include_router(history_router, prefix="/api/history", tags=["Election History"])
app.include_router(events_router, prefix="/api/events", tags=["Events & Recommendations"])
app.include_router(survey_router, prefix="/api/surveys", tags=["Surveys"])
app.include_router(strategy_router, prefix="/api/strategy", tags=["Strategy 4-Quadrant"])
app.include_router(homepage_sso_router, tags=["Homepage SSO"])  # /api/sso/* — myhome 브릿지


# ──────────────── Health Check ─────────────────────────────────────────────
@app.get("/api/health", tags=["System"])
async def health_check():
    return {"status": "ok", "service": "ElectionPulse API", "version": "1.0.0"}
