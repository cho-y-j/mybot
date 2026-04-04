"""
ElectionPulse - Admin Panel API
플랫폼 관리자 전용 — 고객 관리, 시스템 모니터링, 데이터 현황
"""
from datetime import datetime, timezone, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.auth.models import Tenant, User, AuditLog
from app.common.dependencies import CurrentUser
from app.elections.models import (
    Election, Candidate, NewsArticle, CommunityPost,
    YouTubeVideo, SearchTrend, Survey, ScheduleConfig, ScheduleRun, Report,
)

router = APIRouter()


def require_superadmin(user: dict):
    if not user.get("is_superadmin"):
        raise HTTPException(status_code=403, detail="관리자 권한 필요")
    return user


# ──── 시스템 현황 ────

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

    # 최근 수집 시간
    last_news = (await db.execute(
        select(func.max(NewsArticle.collected_at))
    )).scalar()
    last_community = (await db.execute(
        select(func.max(CommunityPost.collected_at))
    )).scalar()
    last_youtube = (await db.execute(
        select(func.max(YouTubeVideo.collected_at))
    )).scalar()

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


# ──── 고객(테넌트) 관리 ────

@router.get("/tenants")
async def list_tenants(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """전체 고객 목록 — 수집 데이터, 최근 수집 시간, 스케줄, 보고서 현황 포함."""
    require_superadmin(user)

    tenants = (await db.execute(select(Tenant).order_by(Tenant.created_at.desc()))).scalars().all()

    result = []
    for t in tenants:
        members = (await db.execute(select(func.count()).where(User.tenant_id == t.id))).scalar()
        elections = (await db.execute(select(func.count()).where(Election.tenant_id == t.id))).scalar()

        # Total data per tenant
        news = (await db.execute(select(func.count()).where(NewsArticle.tenant_id == t.id))).scalar()
        community = (await db.execute(select(func.count()).where(CommunityPost.tenant_id == t.id))).scalar()
        youtube = (await db.execute(select(func.count()).where(YouTubeVideo.tenant_id == t.id))).scalar()

        # Last collection time
        last_news_at = (await db.execute(
            select(func.max(NewsArticle.collected_at)).where(NewsArticle.tenant_id == t.id)
        )).scalar()
        last_community_at = (await db.execute(
            select(func.max(CommunityPost.collected_at)).where(CommunityPost.tenant_id == t.id)
        )).scalar()
        last_youtube_at = (await db.execute(
            select(func.max(YouTubeVideo.collected_at)).where(YouTubeVideo.tenant_id == t.id)
        )).scalar()

        # Most recent collection across all types
        times = [t for t in [last_news_at, last_community_at, last_youtube_at] if t]
        last_collection = max(times).isoformat() if times else None

        # Active schedules
        schedules_active = (await db.execute(
            select(func.count()).where(ScheduleConfig.tenant_id == t.id, ScheduleConfig.enabled == True)
        )).scalar()

        # Recent schedule runs
        recent_run = (await db.execute(
            select(ScheduleRun).where(ScheduleRun.tenant_id == t.id)
            .order_by(ScheduleRun.started_at.desc()).limit(1)
        )).scalar_one_or_none()

        # Reports generated
        reports_count = (await db.execute(
            select(func.count()).where(Report.tenant_id == t.id)
        )).scalar()
        latest_report = (await db.execute(
            select(Report).where(Report.tenant_id == t.id)
            .order_by(Report.created_at.desc()).limit(1)
        )).scalar_one_or_none()

        result.append({
            "id": str(t.id),
            "name": t.name,
            "slug": t.slug,
            "plan": t.plan,
            "is_active": t.is_active,
            "setup_completed": t.setup_completed,
            "members": members,
            "elections": elections,
            "data": {
                "news": news or 0,
                "community": community or 0,
                "youtube": youtube or 0,
                "total": (news or 0) + (community or 0) + (youtube or 0),
            },
            "last_collection": last_collection,
            "schedules_active": schedules_active or 0,
            "last_schedule_run": {
                "status": recent_run.status if recent_run else None,
                "items": recent_run.items_collected if recent_run else None,
                "at": recent_run.started_at.isoformat() if recent_run else None,
            } if recent_run else None,
            "reports": {
                "total": reports_count or 0,
                "latest": {
                    "type": latest_report.report_type,
                    "date": latest_report.report_date.isoformat(),
                    "sent_telegram": latest_report.sent_via_telegram,
                } if latest_report else None,
            },
            "created_at": t.created_at.isoformat(),
        })

    return result


@router.get("/tenants/{tenant_id}")
async def tenant_detail(tenant_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """고객 상세 정보."""
    require_superadmin(user)

    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404)

    # 멤버 목록
    members = (await db.execute(
        select(User).where(User.tenant_id == tenant_id)
    )).scalars().all()

    # 선거 목록
    elections = (await db.execute(
        select(Election).where(Election.tenant_id == tenant_id)
    )).scalars().all()

    # 수집 현황
    news_cnt = (await db.execute(select(func.count()).where(NewsArticle.tenant_id == tenant_id))).scalar()
    community_cnt = (await db.execute(select(func.count()).where(CommunityPost.tenant_id == tenant_id))).scalar()
    yt_cnt = (await db.execute(select(func.count()).where(YouTubeVideo.tenant_id == tenant_id))).scalar()
    trends_cnt = (await db.execute(select(func.count()).where(SearchTrend.tenant_id == tenant_id))).scalar()

    # Last collection times
    last_news = (await db.execute(
        select(func.max(NewsArticle.collected_at)).where(NewsArticle.tenant_id == tenant_id)
    )).scalar()
    last_community = (await db.execute(
        select(func.max(CommunityPost.collected_at)).where(CommunityPost.tenant_id == tenant_id)
    )).scalar()
    last_youtube = (await db.execute(
        select(func.max(YouTubeVideo.collected_at)).where(YouTubeVideo.tenant_id == tenant_id)
    )).scalar()

    # Active schedules
    schedules = (await db.execute(
        select(ScheduleConfig).where(ScheduleConfig.tenant_id == tenant_id)
    )).scalars().all()

    # Recent schedule runs
    recent_runs = (await db.execute(
        select(ScheduleRun).where(ScheduleRun.tenant_id == tenant_id)
        .order_by(ScheduleRun.started_at.desc()).limit(10)
    )).scalars().all()

    # Reports
    reports = (await db.execute(
        select(Report).where(Report.tenant_id == tenant_id)
        .order_by(Report.created_at.desc()).limit(10)
    )).scalars().all()

    return {
        "tenant": {
            "id": str(tenant.id), "name": tenant.name, "slug": tenant.slug,
            "plan": tenant.plan, "is_active": tenant.is_active,
            "setup_completed": tenant.setup_completed, "setup_notes": tenant.setup_notes,
            "max_elections": tenant.max_elections, "max_candidates": tenant.max_candidates,
            "created_at": tenant.created_at.isoformat(),
        },
        "members": [
            {"id": str(m.id), "email": m.email, "name": m.name, "role": m.role,
             "last_login": m.last_login_at.isoformat() if m.last_login_at else None}
            for m in members
        ],
        "elections": [
            {"id": str(e.id), "name": e.name, "type": e.election_type,
             "region": e.region_sido, "date": e.election_date.isoformat(), "active": e.is_active}
            for e in elections
        ],
        "data_stats": {
            "news": news_cnt or 0,
            "community": community_cnt or 0,
            "youtube": yt_cnt or 0,
            "trends": trends_cnt or 0,
            "total": (news_cnt or 0) + (community_cnt or 0) + (yt_cnt or 0),
        },
        "last_collection": {
            "news": last_news.isoformat() if last_news else None,
            "community": last_community.isoformat() if last_community else None,
            "youtube": last_youtube.isoformat() if last_youtube else None,
        },
        "schedules": [
            {
                "id": str(s.id),
                "name": s.name,
                "type": s.schedule_type,
                "times": s.fixed_times,
                "enabled": s.enabled,
                "config": s.config,
            }
            for s in schedules
        ],
        "recent_runs": [
            {
                "status": r.status,
                "items": r.items_collected,
                "started_at": r.started_at.isoformat(),
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "duration": r.duration_seconds,
                "error": r.error_message,
            }
            for r in recent_runs
        ],
        "reports": [
            {
                "id": str(r.id),
                "type": r.report_type,
                "title": r.title,
                "date": r.report_date.isoformat(),
                "sent_telegram": r.sent_via_telegram,
                "created_at": r.created_at.isoformat(),
            }
            for r in reports
        ],
    }


# ──── 전체 회원 목록 ────

@router.get("/users")
async def list_users(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """전체 회원 목록."""
    require_superadmin(user)

    users = (await db.execute(
        select(User, Tenant.name.label("tenant_name"))
        .outerjoin(Tenant, User.tenant_id == Tenant.id)
        .order_by(User.created_at.desc())
    )).all()

    return [
        {
            "id": str(u.id), "email": u.email, "name": u.name,
            "role": u.role, "is_superadmin": u.is_superadmin,
            "is_active": u.is_active, "tenant_name": tn,
            "last_login": u.last_login_at.isoformat() if u.last_login_at else None,
            "created_at": u.created_at.isoformat(),
        }
        for u, tn in users
    ]


# ──── 데이터 현황 ────

@router.get("/data-stats")
async def data_statistics(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """전체 데이터 현황."""
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

    # 추가 테이블 (text 쿼리)
    for tbl in ["election_results", "early_voting", "political_context", "survey_questions"]:
        try:
            cnt = (await db.execute(text(f"SELECT COUNT(*) FROM {tbl}"))).scalar()
            stats[tbl] = cnt
        except:
            stats[tbl] = 0

    # Per-tenant breakdown
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
