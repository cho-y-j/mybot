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
from app.auth.models import Tenant, User, AuditLog, AIAccount
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


# ──── 가입 승인 관리 ────

class ApprovalNote(BaseModel):
    note: Optional[str] = None


@router.get("/pending-users")
async def list_pending_users(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """승인 대기 중인 가입 신청 목록."""
    require_superadmin(user)

    query = (
        select(User)
        .where(User.approval_status == "pending")
        .order_by(User.created_at.desc())
    )
    rows = (await db.execute(query)).scalars().all()

    return [{
        "id": str(u.id),
        "email": u.email,
        "name": u.name,
        "phone": u.phone,
        "organization": u.organization,
        "election_type": u.election_type_applied,
        "region": u.region_applied,
        "candidate_name": u.candidate_name_applied,
        "position": u.position_in_camp,
        "reason": u.apply_reason,
        "applied_at": u.applied_at.isoformat() if u.applied_at else (u.created_at.isoformat() if u.created_at else None),
    } for u in rows]


@router.post("/approve-user/{user_id}")
async def approve_user(
    user_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db), req: ApprovalNote = ApprovalNote(),
):
    """가입 신청 승인 — is_active=True, approval_status='approved'."""
    require_superadmin(user)
    from datetime import datetime, timezone

    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if target.approval_status != "pending":
        raise HTTPException(400, f"이미 처리된 신청입니다 (상태: {target.approval_status})")

    target.approval_status = "approved"
    target.is_active = True
    target.email_verified = True
    target.approved_at = datetime.now(timezone.utc)
    if req.note:
        target.approval_note = req.note

    import json as _json
    db.add(AuditLog(
        user_id=user["id"], action="admin_approve_user",
        resource_type="user", resource_id=str(user_id),
        details=_json.dumps({"email": target.email, "note": req.note}, ensure_ascii=False),
    ))
    await db.commit()
    return {"message": f"{target.name}님의 가입이 승인되었습니다.", "email": target.email}


@router.post("/reject-user/{user_id}")
async def reject_user(
    user_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db), req: ApprovalNote = ApprovalNote(),
):
    """가입 신청 거절."""
    require_superadmin(user)

    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if target.approval_status != "pending":
        raise HTTPException(400, f"이미 처리된 신청입니다 (상태: {target.approval_status})")

    target.approval_status = "rejected"
    if req.note:
        target.approval_note = req.note

    import json as _json
    db.add(AuditLog(
        user_id=user["id"], action="admin_reject_user",
        resource_type="user", resource_id=str(user_id),
        details=_json.dumps({"email": target.email, "note": req.note}, ensure_ascii=False),
    ))
    await db.commit()
    return {"message": f"{target.name}님의 가입이 거절되었습니다.", "email": target.email}


@router.post("/users/{user_id}/toggle-active")
async def toggle_user_active(
    user_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """사용자 활성/정지 토글."""
    require_superadmin(user)
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    target.is_active = not target.is_active
    action = "activate" if target.is_active else "deactivate"
    db.add(AuditLog(
        user_id=user["id"], action=f"admin_{action}_user",
        resource_type="user", resource_id=str(user_id),
    ))
    await db.commit()
    return {"message": f"{target.name} {'활성화' if target.is_active else '정지'} 완료", "is_active": target.is_active}


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

class TenantCreateReq(BaseModel):
    name: str
    plan: str = "basic"
    max_elections: int = 1
    max_members: int = 5
    max_candidates: int = 5
    max_keywords: int = 30


class TenantUpdateReq(BaseModel):
    name: Optional[str] = None
    plan: Optional[str] = None
    max_elections: Optional[int] = None
    max_members: Optional[int] = None
    max_candidates: Optional[int] = None
    max_keywords: Optional[int] = None
    is_active: Optional[bool] = None


class TenantUserCreateReq(BaseModel):
    email: str
    password: str
    name: str
    phone: Optional[str] = None
    role: str = "admin"


@router.post("/tenants", status_code=201)
async def create_tenant_admin(
    req: TenantCreateReq, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """슈퍼관리자: 새 캠프(테넌트) 생성."""
    require_superadmin(user)
    import re
    import uuid as _uuid

    # slug 자동 생성 (이름 소문자 + 영문/숫자만)
    slug_base = re.sub(r'[^a-z0-9]+', '-', req.name.lower()).strip('-')
    if not slug_base:
        slug_base = f"tenant-{_uuid.uuid4().hex[:8]}"

    # slug 중복 체크
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
    import json as _json
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
    if req.plan is not None: tenant.plan = req.plan
    if req.max_elections is not None: tenant.max_elections = req.max_elections
    if req.max_members is not None: tenant.max_members = req.max_members
    if req.max_candidates is not None: tenant.max_candidates = req.max_candidates
    if req.max_keywords is not None: tenant.max_keywords = req.max_keywords
    if req.is_active is not None: tenant.is_active = req.is_active

    import json as _json
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

    # cascade 삭제: tenant_elections 매핑, schedules, reports, 사용자 등
    await db.execute(text("DELETE FROM tenant_elections WHERE tenant_id = :tid"), {"tid": str(tenant_id)})
    await db.execute(text("UPDATE users SET tenant_id = NULL WHERE tenant_id = :tid"), {"tid": str(tenant_id)})
    await db.delete(tenant)
    import json as _json
    tenant_name_for_log = tenant.name
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
    from app.common.security import hash_password
    import uuid as _uuid

    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "캠프를 찾을 수 없습니다")

    # 이메일 중복 체크
    existing = (await db.execute(select(User).where(User.email == req.email))).scalar()
    if existing:
        raise HTTPException(409, "이미 등록된 이메일입니다")

    new_user = User(
        id=_uuid.uuid4(),
        tenant_id=tenant_id,
        email=req.email,
        password_hash=hash_password(req.password),
        name=req.name,
        phone=req.phone,
        role=req.role,
        is_active=True,
        email_verified=True,  # 슈퍼관리자가 생성한 계정은 자동 인증
        is_superadmin=False,
        totp_enabled=False,
    )
    import json as _json
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


class PasswordChangeReq(BaseModel):
    new_password: str


@router.put("/users/{user_id}/password")
async def change_user_password_admin(
    user_id: UUID, req: PasswordChangeReq, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """슈퍼관리자: 사용자 비밀번호 변경."""
    require_superadmin(user)
    from app.common.security import hash_password
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if len(req.new_password) < 8:
        raise HTTPException(400, "비밀번호는 최소 8자 이상이어야 합니다")

    target.password_hash = hash_password(req.new_password)
    target.failed_login_attempts = 0
    target.is_locked = False
    target.locked_until = None

    import json as _json
    db.add(AuditLog(
        user_id=user["id"], action="admin_change_password",
        resource_type="user", resource_id=str(user_id),
        details=_json.dumps({"target_email": target.email}, ensure_ascii=False),
    ))
    await db.commit()
    return {"message": "비밀번호 변경 완료", "email": target.email}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user_admin(
    user_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """슈퍼관리자: 사용자 삭제."""
    require_superadmin(user)
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if target.is_superadmin:
        raise HTTPException(403, "슈퍼관리자는 삭제할 수 없습니다")

    import json as _json
    email_for_log = target.email
    await db.delete(target)
    db.add(AuditLog(
        user_id=user["id"], action="admin_delete_user",
        resource_type="user", resource_id=str(user_id),
        details=_json.dumps({"email": email_for_log}, ensure_ascii=False),
    ))
    await db.commit()


@router.get("/users")
async def list_admin_users(
    user: CurrentUser, db: AsyncSession = Depends(get_db),
    unassigned: bool = False,
):
    """슈퍼관리자: 사용자 목록 (unassigned=true면 캠프 미할당만)."""
    require_superadmin(user)

    query = select(User, Tenant.name).outerjoin(Tenant, User.tenant_id == Tenant.id)
    if unassigned:
        query = query.where(User.tenant_id.is_(None))
    query = query.order_by(User.created_at.desc())

    rows = (await db.execute(query)).all()
    return [{
        "id": str(u.id), "email": u.email, "name": u.name,
        "phone": u.phone, "role": u.role, "is_active": u.is_active,
        "is_superadmin": u.is_superadmin, "email_verified": u.email_verified,
        "tenant_id": str(u.tenant_id) if u.tenant_id else None,
        "tenant_name": tname,
        "approval_status": getattr(u, 'approval_status', None),
        "organization": getattr(u, 'organization', None),
        "candidate_name": getattr(u, 'candidate_name_applied', None),
        "election_type": getattr(u, 'election_type_applied', None),
        "applied_at": u.applied_at.isoformat() if getattr(u, 'applied_at', None) else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    } for u, tname in rows]


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


# ──── 스케줄 모니터링 + 제어 ────

@router.get("/schedule-status")
async def schedule_status(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """전체 스케줄 상태 모니터링 — 각 캠프별 스케줄 + 마지막 실행 + 건강 상태."""
    require_superadmin(user)
    from app.elections.models import ScheduleConfig, ScheduleRun

    tenants = (await db.execute(select(Tenant).where(Tenant.is_active == True).order_by(Tenant.name))).scalars().all()
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

    # Celery worker 건강 상태
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
    from app.elections.models import ScheduleConfig

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


# ──── AI 계정 풀 관리 ────

class AIAccountCreate(BaseModel):
    provider: str  # claude | chatgpt
    name: str
    config_dir: Optional[str] = None
    notes: Optional[str] = None


class AIAccountUpdate(BaseModel):
    name: Optional[str] = None
    config_dir: Optional[str] = None
    status: Optional[str] = None  # active | blocked | inactive
    priority: Optional[int] = None
    notes: Optional[str] = None


@router.get("/ai-accounts")
async def list_ai_accounts(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """AI CLI 계정 목록 + 배정된 캠프 수."""
    require_superadmin(user)
    accounts = (await db.execute(
        select(AIAccount).order_by(AIAccount.priority, AIAccount.created_at)
    )).scalars().all()

    result = []
    for a in accounts:
        assigned = (await db.execute(
            select(func.count()).where(Tenant.ai_account_id == a.id)
        )).scalar() or 0
        result.append({
            "id": str(a.id), "provider": a.provider, "name": a.name,
            "config_dir": a.config_dir, "status": a.status,
            "priority": a.priority, "notes": a.notes,
            "assigned_tenants": assigned,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        })
    return result


@router.post("/ai-accounts", status_code=201)
async def create_ai_account(req: AIAccountCreate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """AI CLI 계정 추가."""
    require_superadmin(user)
    import uuid as _uuid
    account = AIAccount(
        id=_uuid.uuid4(), provider=req.provider, name=req.name,
        config_dir=req.config_dir, notes=req.notes,
    )
    db.add(account)
    await db.flush()
    return {"id": str(account.id), "message": f"{req.provider} 계정 추가 완료"}


@router.put("/ai-accounts/{account_id}")
async def update_ai_account(account_id: UUID, req: AIAccountUpdate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """AI CLI 계정 수정 (상태 변경, 블락 처리 등)."""
    require_superadmin(user)
    account = (await db.execute(select(AIAccount).where(AIAccount.id == account_id))).scalar_one_or_none()
    if not account:
        raise HTTPException(404)
    if req.name is not None: account.name = req.name
    if req.config_dir is not None: account.config_dir = req.config_dir
    if req.status is not None: account.status = req.status
    if req.priority is not None: account.priority = req.priority
    if req.notes is not None: account.notes = req.notes
    return {"message": "수정 완료"}


@router.delete("/ai-accounts/{account_id}", status_code=204)
async def delete_ai_account(account_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """AI CLI 계정 삭제."""
    require_superadmin(user)
    account = (await db.execute(select(AIAccount).where(AIAccount.id == account_id))).scalar_one_or_none()
    if not account:
        raise HTTPException(404)
    # 배정된 캠프 해제
    await db.execute(text("UPDATE tenants SET ai_account_id = NULL WHERE ai_account_id = :aid"), {"aid": str(account_id)})
    await db.delete(account)


@router.post("/ai-accounts/{account_id}/assign")
async def assign_ai_account(account_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db), tenant_ids: list[str] = []):
    """캠프에 AI 계정 배정."""
    require_superadmin(user)
    for tid in tenant_ids:
        await db.execute(text("UPDATE tenants SET ai_account_id = :aid WHERE id = :tid"), {"aid": str(account_id), "tid": tid})
    return {"message": f"{len(tenant_ids)}개 캠프에 배정 완료"}


# ──── 고객 API 키 관리 (관리자가 대행) ────

class TenantAPIKeyUpdate(BaseModel):
    anthropic_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None


@router.put("/tenants/{tenant_id}/api-keys")
async def update_tenant_api_keys(tenant_id: UUID, req: TenantAPIKeyUpdate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """고객의 API 키 설정 (관리자 또는 본인)."""
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404)
    # 권한: 슈퍼관리자 또는 해당 캠프 관리자
    if not user.get("is_superadmin") and str(tenant_id) != user.get("tenant_id"):
        raise HTTPException(403)
    if req.anthropic_api_key is not None:
        tenant.anthropic_api_key = req.anthropic_api_key or None
    if req.openai_api_key is not None:
        tenant.openai_api_key = req.openai_api_key or None
    return {"message": "API 키 업데이트 완료"}
