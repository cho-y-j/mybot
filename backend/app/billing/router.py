"""
ElectionPulse - Billing API
요금제 관리, 결제 처리 (토스페이먼츠 연동)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.auth.models import Tenant
from app.elections.models import Payment
from app.common.dependencies import CurrentUser
from app.tenants.router import PLAN_LIMITS

router = APIRouter()

PLAN_PRICES = {
    "basic": 300000,      # 30만원/월
    "pro": 600000,        # 60만원/월
    "enterprise": 1000000, # 100만원/월
}


@router.get("/plans")
async def list_plans():
    """요금제 목록."""
    return [
        {
            "id": plan,
            "name": {"basic": "Basic", "pro": "Pro", "enterprise": "Enterprise"}[plan],
            "price": PLAN_PRICES[plan],
            "price_display": f"{PLAN_PRICES[plan]:,}원/월",
            "limits": limits,
        }
        for plan, limits in PLAN_LIMITS.items()
    ]


@router.get("/current")
async def current_subscription(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """현재 구독 정보."""
    if not user["tenant_id"]:
        return {"plan": None, "message": "구독 정보가 없습니다"}

    result = await db.execute(
        select(Tenant).where(Tenant.id == user["tenant_id"])
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404)

    return {
        "plan": tenant.plan,
        "price": PLAN_PRICES.get(tenant.plan, 0),
        "limits": PLAN_LIMITS.get(tenant.plan, {}),
        "is_active": tenant.is_active,
        "trial_ends_at": tenant.trial_ends_at.isoformat() if tenant.trial_ends_at else None,
    }


class UpgradePlanRequest(BaseModel):
    plan: str  # basic | pro | enterprise


@router.post("/upgrade")
async def upgrade_plan(
    req: UpgradePlanRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """요금제 업그레이드."""
    if req.plan not in PLAN_LIMITS:
        raise HTTPException(status_code=400, detail="유효하지 않은 요금제입니다")

    result = await db.execute(
        select(Tenant).where(Tenant.id == user["tenant_id"])
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404)

    # 한도 업데이트
    limits = PLAN_LIMITS[req.plan]
    tenant.plan = req.plan
    for key, value in limits.items():
        setattr(tenant, key, value)

    # TODO: 결제 처리 (토스페이먼츠)

    return {
        "message": f"{req.plan} 요금제로 변경되었습니다",
        "plan": req.plan,
        "limits": limits,
    }


@router.get("/history")
async def payment_history(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """결제 내역."""
    result = await db.execute(
        select(Payment)
        .where(Payment.tenant_id == user["tenant_id"])
        .order_by(Payment.created_at.desc())
        .limit(20)
    )
    return [
        {
            "id": str(p.id),
            "amount": p.amount,
            "status": p.status,
            "plan": p.plan,
            "period": f"{p.billing_period_start} ~ {p.billing_period_end}",
            "paid_at": p.paid_at.isoformat() if p.paid_at else None,
        }
        for p in result.scalars().all()
    ]
