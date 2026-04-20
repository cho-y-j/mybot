"""
ElectionPulse - 이메일 브리핑 수신자 API (2026-04-20).

- 기존: mail_service.get_tenant_email_sync()로 tenant 가입 이메일 1명에게만 자동 발송
- 신규: email_recipients 테이블 기반 복수 수신자 + 타입별 on/off + 테스트 발송

라우터 경로: /api/email/*
"""
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.elections.models import EmailRecipient
from app.services.mail_service import (
    send_mail_sync, render_briefing_html, is_configured,
    get_tenant_email_async,
)

router = APIRouter()


# ──────── Schemas ──────────
class RecipientAddRequest(BaseModel):
    email: EmailStr
    name: str
    receive_morning: bool = True
    receive_afternoon: bool = True
    receive_daily: bool = True
    receive_weekly: bool = True


class RecipientUpdateRequest(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    receive_morning: Optional[bool] = None
    receive_afternoon: Optional[bool] = None
    receive_daily: Optional[bool] = None
    receive_weekly: Optional[bool] = None


# ──────── Endpoints ──────────
@router.get("/recipients")
async def list_recipients(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """수신자 목록 + SMTP 설정 상태 + 가입 이메일."""
    rows = (await db.execute(
        select(EmailRecipient).where(EmailRecipient.tenant_id == user["tenant_id"]).order_by(EmailRecipient.created_at)
    )).scalars().all()

    tenant_email = await get_tenant_email_async(db, user["tenant_id"])

    return {
        "smtp_configured": is_configured(),
        "tenant_email": tenant_email,
        "recipients": [
            {
                "id": str(r.id),
                "email": r.email,
                "name": r.name,
                "is_active": r.is_active,
                "receive_morning": r.receive_morning,
                "receive_afternoon": r.receive_afternoon,
                "receive_daily": r.receive_daily,
                "receive_weekly": r.receive_weekly,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.post("/recipients")
async def add_recipient(req: RecipientAddRequest, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    # 중복 체크
    exists = (await db.execute(
        select(EmailRecipient).where(
            EmailRecipient.tenant_id == user["tenant_id"],
            EmailRecipient.email == req.email.lower(),
        )
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail="이미 등록된 이메일입니다")

    rec = EmailRecipient(
        tenant_id=user["tenant_id"],
        email=req.email.lower(),
        name=req.name,
        receive_morning=req.receive_morning,
        receive_afternoon=req.receive_afternoon,
        receive_daily=req.receive_daily,
        receive_weekly=req.receive_weekly,
    )
    db.add(rec)
    await db.flush()
    return {"message": f"{req.name} ({req.email}) 수신자가 추가되었습니다", "id": str(rec.id)}


@router.put("/recipients/{recipient_id}")
async def update_recipient(
    recipient_id: UUID, req: RecipientUpdateRequest,
    user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    rec = (await db.execute(
        select(EmailRecipient).where(
            EmailRecipient.id == recipient_id,
            EmailRecipient.tenant_id == user["tenant_id"],
        )
    )).scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="수신자를 찾을 수 없습니다")

    for field, val in req.model_dump(exclude_unset=True).items():
        setattr(rec, field, val)
    await db.flush()
    return {"message": "수신자 정보가 업데이트되었습니다"}


@router.delete("/recipients/{recipient_id}")
async def delete_recipient(
    recipient_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    rec = (await db.execute(
        select(EmailRecipient).where(
            EmailRecipient.id == recipient_id,
            EmailRecipient.tenant_id == user["tenant_id"],
        )
    )).scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="수신자를 찾을 수 없습니다")

    await db.delete(rec)
    await db.flush()
    return {"message": "수신자가 삭제되었습니다"}


@router.post("/test")
async def send_test_email(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """모든 활성 수신자 + 가입 이메일에 테스트 메일 1통 발송."""
    if not is_configured():
        raise HTTPException(status_code=400, detail="SMTP가 설정되지 않았습니다. 관리자에게 문의하세요.")

    recipients = set()
    tenant_email = await get_tenant_email_async(db, user["tenant_id"])
    if tenant_email:
        recipients.add(tenant_email)

    rows = (await db.execute(
        select(EmailRecipient).where(
            EmailRecipient.tenant_id == user["tenant_id"],
            EmailRecipient.is_active == True,
        )
    )).scalars().all()
    for r in rows:
        recipients.add(r.email)

    if not recipients:
        raise HTTPException(status_code=400, detail="수신자가 없습니다. 가입 이메일 또는 추가 수신자를 등록하세요.")

    subject = "[ElectionPulse] 테스트 메일"
    body = (
        "이메일 브리핑 테스트 메일입니다.\n\n"
        "이 메일이 정상적으로 도착했다면, 매일 오전 07:00·오후 13:00 브리핑과 "
        "18:00 일일 보고서 PDF가 이 주소로 자동 발송됩니다.\n\n"
        "— ElectionPulse"
    )
    html = render_briefing_html(
        "morning", body,
        election_name="테스트 메일",
        candidate_name="",
        report_date="",
    )

    import asyncio
    results = []
    for to in recipients:
        result = await asyncio.to_thread(send_mail_sync, to, subject, html, body)
        results.append({"to": to, "status": result.get("status"), "error": result.get("error")})

    sent = sum(1 for r in results if r["status"] == "sent")
    return {
        "message": f"{sent}/{len(recipients)}명에게 발송 완료",
        "results": results,
    }
