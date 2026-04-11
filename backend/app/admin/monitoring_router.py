"""Admin — 시스템 헬스 + 데이터 통계 + 스케줄 제어."""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.models import Tenant, User
from app.common.dependencies import CurrentUser
from app.elections.models import (
    Election, Candidate, NewsArticle, CommunityPost, YouTubeVideo,
    SearchTrend, Survey, ScheduleConfig, ScheduleRun, Report,
)

from .common import require_superadmin

router = APIRouter()


# ──── 시스템 헬스 ────

@router.get("/system/health")
async def system_health(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """시스템 전체 현황."""
    require_superadmin(user)

    tenant_count = (await db.execute(select(func.count()).select_from(Tenant))).scalar()
    active_tenants = (await db.execute(select(func.count()).where(Tenant.is_active == True))).scalar()
    user_count = (await db.execute(select(func.count()).select_from(User))).scalar()
    election_count = (await db.execute(select(func.count()).select_from(Election))).scalar()
    news_count = (await db.execute(select(func.count()).select_from(NewsArticle))).scalar()
    community_count = (await db.execute(select(func.count()).select_from(CommunityPost))).scalar()
    youtube_count = (await db.execute(select(func.count()).select_from(YouTubeVideo))).scalar()
    survey_count = (await db.execute(select(func.count()).select_from(Survey))).scalar()
    schedule_count = (await db.execute(select(func.count()).where(ScheduleConfig.enabled == True))).scalar()
    report_count = (await db.execute(select(func.count()).select_from(Report))).scalar()

    last_news = (await db.execute(select(func.max(NewsArticle.collected_at)))).scalar()
    last_community = (await db.execute(select(func.max(CommunityPost.collected_at)))).scalar()
    last_youtube = (await db.execute(select(func.max(YouTubeVideo.collected_at)))).scalar()

    return {
        "status": "healthy",
        "tenants": {"total": tenant_count, "active": active_tenants},
        "users": user_count,
        "elections": election_count,
        "data": {
            "news": news_count,
            "community": community_count,
            "youtube": youtube_count,
            "surveys": survey_count,
            "total": (news_count or 0) + (community_count or 0) + (youtube_count or 0) + (survey_count or 0),
            "schedules_active": schedule_count,
            "reports_generated": report_count,
        },
        "last_collection": {
            "news": last_news.isoformat() if last_news else None,
            "community": last_community.isoformat() if last_community else None,
            "youtube": last_youtube.isoformat() if last_youtube else None,
        },
    }


# ──── 데이터 통계 ────

@router.get("/data-stats")
async def data_statistics(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """전체 데이터 현황 + 테넌트별 breakdown."""
    require_superadmin(user)

    tables = {
        "news_articles": NewsArticle,
        "surveys": Survey,
        "search_trends": SearchTrend,
        "youtube_videos": YouTubeVideo,
        "community_posts": CommunityPost,
        "elections": Election,
        "candidates": Candidate,
        "schedule_configs": ScheduleConfig,
        "reports": Report,
    }

    stats = {}
    for name, model in tables.items():
        cnt = (await db.execute(select(func.count()).select_from(model))).scalar()
        stats[name] = cnt

    for tbl in ["election_results", "early_voting", "political_context", "survey_questions"]:
        try:
            cnt = (await db.execute(text(f"SELECT COUNT(*) FROM {tbl}"))).scalar()
            stats[tbl] = cnt
        except Exception:
            stats[tbl] = 0

    tenants = (await db.execute(select(Tenant).where(Tenant.is_active == True))).scalars().all()
    per_tenant = []
    for t in tenants:
        t_news = (await db.execute(select(func.count()).where(NewsArticle.tenant_id == t.id))).scalar() or 0
        t_community = (await db.execute(select(func.count()).where(CommunityPost.tenant_id == t.id))).scalar() or 0
        t_youtube = (await db.execute(select(func.count()).where(YouTubeVideo.tenant_id == t.id))).scalar() or 0
        t_reports = (await db.execute(select(func.count()).where(Report.tenant_id == t.id))).scalar() or 0
        per_tenant.append({
            "tenant_id": str(t.id),
            "tenant_name": t.name,
            "news": t_news,
            "community": t_community,
            "youtube": t_youtube,
            "reports": t_reports,
            "total": t_news + t_community + t_youtube,
        })

    return {
        "tables": stats,
        "total": sum(stats.values()),
        "per_tenant": per_tenant,
    }


# ──── 스케줄 모니터링 + 제어 ────

@router.get("/schedule-status")
async def schedule_status(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """전체 스케줄 상태 모니터링."""
    require_superadmin(user)

    tenants = (await db.execute(
        select(Tenant).where(Tenant.is_active == True).order_by(Tenant.name)
    )).scalars().all()
    result = []

    for t in tenants:
        schedules = (await db.execute(
            select(ScheduleConfig).where(ScheduleConfig.tenant_id == t.id)
        )).scalars().all()

        last_run = (await db.execute(
            select(ScheduleRun).where(ScheduleRun.tenant_id == t.id)
            .order_by(ScheduleRun.started_at.desc()).limit(1)
        )).scalar_one_or_none()

        last_news = (await db.execute(
            select(func.max(NewsArticle.collected_at)).where(NewsArticle.tenant_id == t.id)
        )).scalar()

        enabled_count = sum(1 for s in schedules if s.enabled)
        total_count = len(schedules)

        result.append({
            "tenant_id": str(t.id),
            "tenant_name": t.name,
            "schedules_total": total_count,
            "schedules_enabled": enabled_count,
            "schedules": [
                {"name": s.name, "type": s.schedule_type, "times": s.fixed_times, "enabled": s.enabled}
                for s in schedules
            ],
            "last_run": {
                "status": last_run.status if last_run else None,
                "items": last_run.items_collected if last_run else None,
                "at": last_run.started_at.isoformat() if last_run else None,
                "error": last_run.error_message if last_run else None,
            } if last_run else None,
            "last_data_at": last_news.isoformat() if last_news else None,
        })

    celery_healthy = False
    try:
        from app.collectors.tasks import celery_app
        insp = celery_app.control.inspect()
        active = insp.active()
        celery_healthy = active is not None and len(active) > 0
    except Exception:
        pass

    return {
        "celery_healthy": celery_healthy,
        "tenants": result,
    }


@router.post("/schedule-control/{tenant_id}")
async def schedule_control(
    tenant_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db),
    action: str = "pause",  # pause | resume
):
    """캠프 스케줄 일괄 정지/재개."""
    require_superadmin(user)

    enabled = action == "resume"
    result = await db.execute(
        text("UPDATE schedule_configs SET enabled = :e WHERE tenant_id = :tid"),
        {"e": enabled, "tid": str(tenant_id)},
    )
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    return {
        "message": f"{tenant.name if tenant else tenant_id} 스케줄 {'재개' if enabled else '정지'}",
        "action": action,
        "affected": result.rowcount,
    }


@router.post("/schedule-control-all")
async def schedule_control_all(
    user: CurrentUser, db: AsyncSession = Depends(get_db),
    action: str = "pause",  # pause | resume
):
    """전체 캠프 스케줄 일괄 정지/재개."""
    require_superadmin(user)
    enabled = action == "resume"
    result = await db.execute(
        text("UPDATE schedule_configs SET enabled = :e"), {"e": enabled},
    )
    return {
        "message": f"전체 스케줄 {'재개' if enabled else '정지'}",
        "affected": result.rowcount,
    }
