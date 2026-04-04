"""
ElectionPulse - Admin Panel API
플랫폼 관리자 전용 — 고객 관리, 시스템 모니터링, 데이터 현황
"""
from datetime import datetime, timezone
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
    YouTubeVideo, SearchTrend, Survey, ScheduleConfig, Report,
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
    survey_count = (await db.execute(select(func.count()).select_from(Survey))).scalar()
    schedule_count = (await db.execute(select(func.count()).where(ScheduleConfig.enabled == True))).scalar()

    return {
        "status": "healthy",
        "tenants": {"total": tenant_count, "active": active_tenants},
        "users": user_count,
        "elections": election_count,
        "data": {
            "news": news_count,
            "surveys": survey_count,
            "schedules_active": schedule_count,
        },
    }


# ──── 고객(테넌트) 관리 ────

@router.get("/tenants")
async def list_tenants(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """전체 고객 목록."""
    require_superadmin(user)

    tenants = (await db.execute(select(Tenant).order_by(Tenant.created_at.desc()))).scalars().all()

    result = []
    for t in tenants:
        members = (await db.execute(select(func.count()).where(User.tenant_id == t.id))).scalar()
        elections = (await db.execute(select(func.count()).where(Election.tenant_id == t.id))).scalar()
        news = (await db.execute(select(func.count()).where(NewsArticle.tenant_id == t.id))).scalar()
        schedules = (await db.execute(select(func.count()).where(ScheduleConfig.tenant_id == t.id, ScheduleConfig.enabled == True))).scalar()

        result.append({
            "id": str(t.id),
            "name": t.name,
            "slug": t.slug,
            "plan": t.plan,
            "is_active": t.is_active,
            "setup_completed": t.setup_completed,
            "members": members,
            "elections": elections,
            "news_collected": news,
            "schedules_active": schedules,
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
    yt_cnt = (await db.execute(select(func.count()).where(YouTubeVideo.tenant_id == tenant_id))).scalar()

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
            "news": news_cnt, "youtube": yt_cnt,
        },
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

    return {"tables": stats, "total": sum(stats.values())}
