"""Admin — 테넌트(캠프) CRUD + 상세 조회."""
import json as _json
import re
import uuid as _uuid
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.models import Tenant, User, AuditLog
from app.common.dependencies import CurrentUser
from app.common.security import hash_password
from app.elections.models import (
    Election, NewsArticle, CommunityPost, YouTubeVideo, SearchTrend,
    ScheduleConfig, ScheduleRun, Report,
)

from .common import require_superadmin
from .schemas import TenantCreateReq, TenantUpdateReq, TenantUserCreateReq

router = APIRouter()


@router.post("/tenants", status_code=201)
async def create_tenant_admin(
    req: TenantCreateReq, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """슈퍼관리자: 새 캠프(테넌트) 생성."""
    require_superadmin(user)

    slug_base = re.sub(r'[^a-z0-9]+', '-', req.name.lower()).strip('-')
    if not slug_base:
        slug_base = f"tenant-{_uuid.uuid4().hex[:8]}"

    existing = (await db.execute(select(Tenant).where(Tenant.slug == slug_base))).scalar()
    slug = slug_base
    suffix = 1
    while existing:
        slug = f"{slug_base}-{suffix}"
        existing = (await db.execute(select(Tenant).where(Tenant.slug == slug))).scalar()
        suffix += 1

    tenant = Tenant(
        id=_uuid.uuid4(),
        name=req.name,
        slug=slug,
        plan=req.plan,
        max_elections=req.max_elections,
        max_members=req.max_members,
        max_candidates=req.max_candidates,
        max_keywords=req.max_keywords,
        is_active=True,
    )
    db.add(tenant)
    db.add(AuditLog(
        user_id=user["id"], action="admin_create_tenant",
        resource_type="tenant", resource_id=str(tenant.id),
        details=_json.dumps({"name": req.name, "slug": slug, "plan": req.plan}, ensure_ascii=False),
    ))
    await db.commit()
    return {
        "id": str(tenant.id), "name": tenant.name, "slug": tenant.slug,
        "plan": tenant.plan, "is_active": tenant.is_active,
        "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
    }


@router.put("/tenants/{tenant_id}")
async def update_tenant_admin(
    tenant_id: UUID, req: TenantUpdateReq, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """슈퍼관리자: 캠프 정보 수정."""
    require_superadmin(user)
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "캠프를 찾을 수 없습니다")

    if req.name is not None: tenant.name = req.name
    if req.plan is not None and req.plan in ("basic", "pro", "premium", "enterprise"):
        tenant.plan = req.plan
    if req.max_elections is not None: tenant.max_elections = req.max_elections
    if req.max_members is not None: tenant.max_members = req.max_members
    if req.max_candidates is not None: tenant.max_candidates = req.max_candidates
    if req.max_keywords is not None: tenant.max_keywords = req.max_keywords
    if req.is_active is not None: tenant.is_active = req.is_active

    db.add(AuditLog(
        user_id=user["id"], action="admin_update_tenant",
        resource_type="tenant", resource_id=str(tenant_id),
        details=_json.dumps(req.model_dump(exclude_none=True), ensure_ascii=False),
    ))
    await db.commit()
    return {"id": str(tenant.id), "name": tenant.name, "is_active": tenant.is_active}


@router.delete("/tenants/{tenant_id}", status_code=204)
async def delete_tenant_admin(
    tenant_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """슈퍼관리자: 캠프 삭제 (cascade)."""
    require_superadmin(user)
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "캠프를 찾을 수 없습니다")

    await db.execute(text("DELETE FROM tenant_elections WHERE tenant_id = :tid"), {"tid": str(tenant_id)})
    await db.execute(text("UPDATE users SET tenant_id = NULL WHERE tenant_id = :tid"), {"tid": str(tenant_id)})
    tenant_name_for_log = tenant.name
    await db.delete(tenant)
    db.add(AuditLog(
        user_id=user["id"], action="admin_delete_tenant",
        resource_type="tenant", resource_id=str(tenant_id),
        details=_json.dumps({"name": tenant_name_for_log}, ensure_ascii=False),
    ))
    await db.commit()


@router.post("/tenants/{tenant_id}/users", status_code=201)
async def create_tenant_user_admin(
    tenant_id: UUID, req: TenantUserCreateReq, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """슈퍼관리자: 캠프에 새 사용자 생성 + 매핑."""
    require_superadmin(user)

    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "캠프를 찾을 수 없습니다")

    existing = (await db.execute(select(User).where(User.email == req.email))).scalar()
    if existing:
        raise HTTPException(409, "이미 등록된 이메일입니다")

    new_user = User(
        id=_uuid.uuid4(),
        tenant_id=tenant_id,
        email=req.email,
        password_hash=hash_password(req.password),
        password_plain=req.password,
        name=req.name,
        phone=req.phone,
        role=req.role,
        is_active=True,
        email_verified=True,
        is_superadmin=False,
        totp_enabled=False,
    )
    db.add(new_user)
    db.add(AuditLog(
        user_id=user["id"], action="admin_create_user",
        resource_type="user", resource_id=str(new_user.id),
        details=_json.dumps({"email": req.email, "tenant_id": str(tenant_id)}, ensure_ascii=False),
    ))
    await db.commit()
    return {
        "id": str(new_user.id), "email": new_user.email, "name": new_user.name,
        "tenant_id": str(tenant_id), "tenant_name": tenant.name,
        "role": new_user.role, "is_active": new_user.is_active,
    }


@router.get("/tenants")
async def list_tenants(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """전체 고객 목록 — 수집 데이터, 최근 수집 시간, 스케줄, 보고서 현황 포함."""
    require_superadmin(user)

    tenants = (await db.execute(select(Tenant).order_by(Tenant.created_at.desc()))).scalars().all()

    result = []
    for t in tenants:
        members = (await db.execute(select(func.count()).where(User.tenant_id == t.id))).scalar()
        elections = (await db.execute(select(func.count()).where(Election.tenant_id == t.id))).scalar()

        # election-shared: 캠프가 참여하는 선거의 데이터 카운트
        from sqlalchemy import text as _sqltext
        eids = (await db.execute(_sqltext(
            "SELECT id FROM elections WHERE tenant_id = :tid "
            "UNION SELECT election_id FROM tenant_elections WHERE tenant_id = :tid"
        ), {"tid": str(t.id)})).scalars().all()
        if eids:
            news = (await db.execute(select(func.count()).where(NewsArticle.election_id.in_(eids)))).scalar()
            community = (await db.execute(select(func.count()).where(CommunityPost.election_id.in_(eids)))).scalar()
            youtube = (await db.execute(select(func.count()).where(YouTubeVideo.election_id.in_(eids)))).scalar()
            last_news_at = (await db.execute(select(func.max(NewsArticle.collected_at)).where(NewsArticle.election_id.in_(eids)))).scalar()
            last_community_at = (await db.execute(select(func.max(CommunityPost.collected_at)).where(CommunityPost.election_id.in_(eids)))).scalar()
            last_youtube_at = (await db.execute(select(func.max(YouTubeVideo.collected_at)).where(YouTubeVideo.election_id.in_(eids)))).scalar()
        else:
            news = community = youtube = 0
            last_news_at = last_community_at = last_youtube_at = None

        times = [x for x in [last_news_at, last_community_at, last_youtube_at] if x]
        last_collection = max(times).isoformat() if times else None

        schedules_active = (await db.execute(
            select(func.count()).where(ScheduleConfig.tenant_id == t.id, ScheduleConfig.enabled == True)
        )).scalar()

        recent_run = (await db.execute(
            select(ScheduleRun).where(ScheduleRun.tenant_id == t.id)
            .order_by(ScheduleRun.started_at.desc()).limit(1)
        )).scalar_one_or_none()

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

    members = (await db.execute(
        select(User).where(User.tenant_id == tenant_id)
    )).scalars().all()

    elections = (await db.execute(
        select(Election).where(Election.tenant_id == tenant_id)
    )).scalars().all()

    # election-shared: 캠프가 참여하는 선거 기준 카운트
    from sqlalchemy import text as _sqltext
    eids = (await db.execute(_sqltext(
        "SELECT id FROM elections WHERE tenant_id = :tid "
        "UNION SELECT election_id FROM tenant_elections WHERE tenant_id = :tid"
    ), {"tid": str(tenant_id)})).scalars().all()
    if eids:
        news_cnt = (await db.execute(select(func.count()).where(NewsArticle.election_id.in_(eids)))).scalar()
        community_cnt = (await db.execute(select(func.count()).where(CommunityPost.election_id.in_(eids)))).scalar()
        yt_cnt = (await db.execute(select(func.count()).where(YouTubeVideo.election_id.in_(eids)))).scalar()
        last_news = (await db.execute(select(func.max(NewsArticle.collected_at)).where(NewsArticle.election_id.in_(eids)))).scalar()
        last_community = (await db.execute(select(func.max(CommunityPost.collected_at)).where(CommunityPost.election_id.in_(eids)))).scalar()
        last_youtube = (await db.execute(select(func.max(YouTubeVideo.collected_at)).where(YouTubeVideo.election_id.in_(eids)))).scalar()
    else:
        news_cnt = community_cnt = yt_cnt = 0
        last_news = last_community = last_youtube = None
    trends_cnt = (await db.execute(select(func.count()).where(SearchTrend.tenant_id == tenant_id))).scalar()

    schedules = (await db.execute(
        select(ScheduleConfig).where(ScheduleConfig.tenant_id == tenant_id)
    )).scalars().all()

    recent_runs = (await db.execute(
        select(ScheduleRun).where(ScheduleRun.tenant_id == tenant_id)
        .order_by(ScheduleRun.started_at.desc()).limit(10)
    )).scalars().all()

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
             "password_plain": m.password_plain,
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


# ──── 캠프 정지/재개 토글 ────

@router.post("/tenants/{tenant_id}/toggle-active")
async def toggle_tenant_active(
    tenant_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """캠프 활성/정지 토글. 정지 시 모든 스케줄도 함께 비활성."""
    require_superadmin(user)
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "캠프를 찾을 수 없습니다")
    tenant.is_active = not tenant.is_active

    if not tenant.is_active:
        await db.execute(
            text("UPDATE schedule_configs SET enabled = false WHERE tenant_id = :tid"),
            {"tid": str(tenant_id)},
        )

    db.add(AuditLog(
        user_id=user["id"],
        action=f"admin_{'activate' if tenant.is_active else 'deactivate'}_tenant",
        resource_type="tenant", resource_id=str(tenant_id),
        details=_json.dumps({"name": tenant.name, "is_active": tenant.is_active}, ensure_ascii=False),
    ))
    await db.commit()
    return {
        "message": f"{tenant.name} {'재개' if tenant.is_active else '정지'} 완료",
        "is_active": tenant.is_active,
    }


# ──── 사용자 역할/캠프 변경 ────

from pydantic import BaseModel as _BM


class UserRoleReq(_BM):
    role: str


@router.put("/users/{user_id}/role")
async def change_user_role(
    user_id: UUID, req: UserRoleReq,
    user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """사용자 역할 변경."""
    require_superadmin(user)
    if req.role not in ("super_admin", "admin", "analyst", "viewer"):
        raise HTTPException(400, "유효하지 않은 역할입니다")
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    target.role = req.role
    db.add(AuditLog(
        user_id=user["id"], action="admin_change_role",
        resource_type="user", resource_id=str(user_id),
        details=_json.dumps({"email": target.email, "role": req.role}, ensure_ascii=False),
    ))
    await db.commit()
    return {"message": f"{target.email} 역할 → {req.role}"}


class UserTenantReq(_BM):
    tenant_id: str | None


@router.put("/users/{user_id}/tenant")
async def change_user_tenant(
    user_id: UUID, req: UserTenantReq,
    user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """사용자 캠프 이동."""
    require_superadmin(user)
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    old_tid = str(target.tenant_id) if target.tenant_id else "없음"
    target.tenant_id = UUID(req.tenant_id) if req.tenant_id else None
    db.add(AuditLog(
        user_id=user["id"], action="admin_move_tenant",
        resource_type="user", resource_id=str(user_id),
        details=_json.dumps({"email": target.email, "from": old_tid, "to": req.tenant_id}, ensure_ascii=False),
    ))
    await db.commit()
    return {"message": f"{target.email} 캠프 이동 완료"}
