"""Admin — 시스템 헬스 + 데이터 통계 + 스케줄 제어."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
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


# ──── 감사 로그 ────

@router.get("/audit-logs")
async def list_audit_logs(
    user: CurrentUser, db: AsyncSession = Depends(get_db),
    limit: int = 20,
):
    """최근 감사 로그 조회."""
    require_superadmin(user)
    rows = (await db.execute(
        text("""
            SELECT a.action, a.resource_type, a.details, a.ip_address, a.created_at,
                   u.email as user_email, u.name as user_name
            FROM audit_logs a
            LEFT JOIN users u ON u.id = a.user_id
            ORDER BY a.created_at DESC
            LIMIT :lim
        """),
        {"lim": limit},
    )).fetchall()
    return [
        {
            "action": r.action,
            "resource_type": r.resource_type,
            "details": r.details,
            "ip_address": r.ip_address,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "user_email": r.user_email,
            "user_name": r.user_name,
        }
        for r in rows
    ]


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


# ──── 접속 통계 ────

@router.get("/access-stats")
async def access_stats(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """최근 14일 일별 로그인 횟수."""
    require_superadmin(user)
    rows = (await db.execute(text("""
        SELECT DATE(created_at) AS date, COUNT(*) AS logins
        FROM audit_logs
        WHERE action = 'login'
          AND created_at >= NOW() - INTERVAL '14 days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
    """))).fetchall()
    return {
        "daily": [{"date": r.date.isoformat(), "logins": r.logins} for r in rows],
    }


# ──── AI / 스케줄 실행 통계 ────

@router.get("/ai-usage")
async def ai_usage(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """최근 7일 테넌트별 스케줄 실행 통계."""
    require_superadmin(user)
    rows = (await db.execute(text("""
        SELECT t.name AS tenant_name,
               COUNT(*) AS runs,
               COUNT(*) FILTER (WHERE sr.status = 'success') AS success,
               COUNT(*) FILTER (WHERE sr.status IN ('failed', 'error')) AS failed
        FROM schedule_runs sr
        JOIN tenants t ON t.id = sr.tenant_id
        WHERE sr.started_at >= NOW() - INTERVAL '7 days'
        GROUP BY t.name
        ORDER BY runs DESC
    """))).fetchall()

    total = sum(r.runs for r in rows)
    return {
        "by_tenant": [
            {"tenant_name": r.tenant_name, "runs": r.runs, "success": r.success, "failed": r.failed}
            for r in rows
        ],
        "total_runs_7d": total,
    }


# ──── 에러 로그 ────

@router.get("/error-logs")
async def error_logs(
    user: CurrentUser, db: AsyncSession = Depends(get_db),
    limit: int = 20,
):
    """최근 실패/에러 스케줄 실행 목록."""
    require_superadmin(user)
    rows = (await db.execute(
        text("""
            SELECT t.name AS tenant_name,
                   sc.schedule_type AS task_type,
                   sr.error_message AS error,
                   sr.started_at AS created_at
            FROM schedule_runs sr
            JOIN tenants t ON t.id = sr.tenant_id
            LEFT JOIN schedule_configs sc ON sc.id = sr.schedule_id
            WHERE sr.status IN ('failed', 'error')
            ORDER BY sr.started_at DESC
            LIMIT :lim
        """),
        {"lim": limit},
    )).fetchall()
    return [
        {
            "tenant_name": r.tenant_name,
            "task_type": r.task_type,
            "error": r.error,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


# ──── 선거 이름 수정 ────

@router.put("/elections/{election_id}")
async def update_election(
    election_id: UUID,
    body: dict,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """선거 이름 수정 (관리자)."""
    require_superadmin(user)

    new_name = body.get("name")
    if not new_name or not new_name.strip():
        raise HTTPException(status_code=400, detail="name은 필수입니다")

    result = await db.execute(
        text("UPDATE elections SET name = :name WHERE id = :eid"),
        {"name": new_name.strip(), "eid": str(election_id)},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="선거를 찾을 수 없습니다")

    await db.commit()
    return {"message": "선거 이름 수정 완료", "election_id": str(election_id), "name": new_name.strip()}


# ──── 수동 수집 트리거 ────

@router.post("/trigger-collection/{tenant_id}")
async def trigger_collection(
    tenant_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """테넌트 수동 수집 트리거."""
    require_superadmin(user)

    schedule = (await db.execute(
        select(ScheduleConfig).where(
            ScheduleConfig.tenant_id == tenant_id,
            ScheduleConfig.enabled == True,
        ).limit(1)
    )).scalar_one_or_none()

    if not schedule:
        raise HTTPException(status_code=404, detail="활성화된 스케줄이 없습니다")

    election_id = str(schedule.election_id)

    from app.collectors.tasks import full_collection_with_briefing
    task = full_collection_with_briefing.delay(str(tenant_id), election_id)

    return {
        "message": "수집 트리거 완료",
        "task_id": task.id,
        "tenant_id": str(tenant_id),
        "election_id": election_id,
    }
