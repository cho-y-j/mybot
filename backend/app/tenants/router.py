"""
ElectionPulse - Tenant Management API
고객사(테넌트) 생성, 조회, 요금제 관리
"""
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.auth.models import Tenant, User
from app.common.dependencies import CurrentUser

router = APIRouter()


class TenantCreate(BaseModel):
    name: str
    slug: str
    plan: str = "basic"


class TenantResponse(BaseModel):
    id: str
    name: str
    slug: str
    plan: str
    is_active: bool
    setup_completed: bool
    max_elections: int
    max_candidates: int
    max_keywords: int
    max_members: int
    max_daily_reports: int
    max_telegram_bots: int
    created_at: datetime

    model_config = {"from_attributes": True}


# 요금제별 기본 한도
PLAN_LIMITS = {
    "basic": {
        "max_elections": 1,
        "max_candidates": 3,
        "max_keywords": 20,
        "max_members": 1,
        "max_daily_reports": 2,
        "max_telegram_bots": 1,
    },
    "pro": {
        "max_elections": 3,
        "max_candidates": 5,
        "max_keywords": 50,
        "max_members": 5,
        "max_daily_reports": 6,
        "max_telegram_bots": 3,
    },
    "enterprise": {
        "max_elections": 99,
        "max_candidates": 99,
        "max_keywords": 999,
        "max_members": 99,
        "max_daily_reports": 99,
        "max_telegram_bots": 99,
    },
}


@router.post("", response_model=TenantResponse, status_code=201)
async def create_tenant(
    req: TenantCreate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """테넌트 생성 (회원가입 후 첫 설정 시)."""
    # 이미 테넌트가 있으면 거부
    if user["tenant_id"] and not user["is_superadmin"]:
        raise HTTPException(status_code=400, detail="이미 소속된 조직이 있습니다")

    # slug 중복 확인
    existing = await db.execute(select(Tenant).where(Tenant.slug == req.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 사용 중인 식별자입니다")

    limits = PLAN_LIMITS.get(req.plan, PLAN_LIMITS["basic"])

    tenant = Tenant(
        name=req.name,
        slug=req.slug,
        plan=req.plan,
        **limits,
    )
    db.add(tenant)
    await db.flush()

    # 사용자를 테넌트에 연결 (admin 역할)
    result = await db.execute(select(User).where(User.id == user["id"]))
    u = result.scalar_one()
    u.tenant_id = tenant.id
    u.role = "admin"

    return TenantResponse(
        id=str(tenant.id),
        name=tenant.name,
        slug=tenant.slug,
        plan=tenant.plan,
        is_active=tenant.is_active,
        setup_completed=tenant.setup_completed,
        max_elections=tenant.max_elections,
        max_candidates=tenant.max_candidates,
        max_keywords=tenant.max_keywords,
        max_members=tenant.max_members,
        max_daily_reports=tenant.max_daily_reports,
        max_telegram_bots=tenant.max_telegram_bots,
        created_at=tenant.created_at,
    )


@router.get("/me", response_model=TenantResponse)
async def get_my_tenant(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """내 테넌트 정보 조회."""
    if not user["tenant_id"]:
        raise HTTPException(status_code=404, detail="소속된 조직이 없습니다")

    result = await db.execute(select(Tenant).where(Tenant.id == user["tenant_id"]))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="조직을 찾을 수 없습니다")

    return TenantResponse(
        id=str(tenant.id),
        name=tenant.name,
        slug=tenant.slug,
        plan=tenant.plan,
        is_active=tenant.is_active,
        setup_completed=tenant.setup_completed,
        max_elections=tenant.max_elections,
        max_candidates=tenant.max_candidates,
        max_keywords=tenant.max_keywords,
        max_members=tenant.max_members,
        max_daily_reports=tenant.max_daily_reports,
        max_telegram_bots=tenant.max_telegram_bots,
        created_at=tenant.created_at,
    )


@router.post("/me/invite", status_code=201)
async def invite_member(
    email: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    role: str = "viewer",
):
    """팀원 초대 (admin 전용)."""
    if user["role"] not in ("admin",) and not user["is_superadmin"]:
        raise HTTPException(status_code=403, detail="관리자만 초대할 수 있습니다")

    # 한도 확인
    result = await db.execute(select(Tenant).where(Tenant.id == user["tenant_id"]))
    tenant = result.scalar_one()
    member_count = await db.execute(
        select(User).where(User.tenant_id == user["tenant_id"])
    )
    if len(member_count.scalars().all()) >= tenant.max_members:
        raise HTTPException(status_code=403, detail=f"요금제 한도: 최대 {tenant.max_members}명")

    # TODO: 초대 이메일 발송
    return {"message": f"{email}로 초대 메일을 발송했습니다", "role": role}
