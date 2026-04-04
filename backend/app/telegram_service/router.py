"""
ElectionPulse - Telegram API
봇 연결, 수신자 관리 (여러 명/그룹), 테스트/브리핑 발송
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.elections.models import TelegramConfig, TelegramRecipient, Election
from app.telegram_service.bot import TelegramBot

router = APIRouter()


# ──────── Schemas ──────────

class BotConnectRequest(BaseModel):
    bot_token: str


class RecipientAddRequest(BaseModel):
    chat_id: str
    name: str
    chat_type: str = "private"  # private | group
    receive_news: bool = True
    receive_briefing: bool = True
    receive_alert: bool = True


class RecipientUpdateRequest(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    receive_news: Optional[bool] = None
    receive_briefing: Optional[bool] = None
    receive_alert: Optional[bool] = None


# ──────── Bot Connection ──────────

@router.post("/connect-bot")
async def connect_bot(
    req: BotConnectRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """텔레그램 봇 연결 (봇 토큰만 — 수신자는 별도 추가)."""
    bot = TelegramBot(req.bot_token, "0")
    bot_info = await bot.verify_token()
    if not bot_info:
        raise HTTPException(status_code=400, detail="유효하지 않은 봇 토큰입니다")

    # 기존 설정 업데이트 또는 새로 생성
    result = await db.execute(
        select(TelegramConfig).where(TelegramConfig.tenant_id == user["tenant_id"])
    )
    config = result.scalar_one_or_none()

    if config:
        config.bot_token = req.bot_token
        config.bot_username = bot_info.get("username", "")
        config.is_active = True
    else:
        config = TelegramConfig(
            tenant_id=user["tenant_id"],
            bot_token=req.bot_token,
            bot_username=bot_info.get("username", ""),
        )
        db.add(config)

    await db.flush()

    return {
        "message": "봇이 연결되었습니다. 이제 수신자를 추가하세요.",
        "bot_name": bot_info.get("first_name", ""),
        "bot_username": bot_info.get("username", ""),
        "config_id": str(config.id),
    }


# 기존 connect 엔드포인트 호환 (봇 + 1명 동시)
@router.post("/connect")
async def connect_telegram(
    bot_token: str,
    chat_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """봇 연결 + 첫 번째 수신자 등록 (기존 호환)."""
    bot = TelegramBot(bot_token, "0")
    bot_info = await bot.verify_token()
    if not bot_info:
        raise HTTPException(status_code=400, detail="유효하지 않은 봇 토큰입니다")

    result = await db.execute(
        select(TelegramConfig).where(TelegramConfig.tenant_id == user["tenant_id"])
    )
    config = result.scalar_one_or_none()

    if config:
        config.bot_token = bot_token
        config.bot_username = bot_info.get("username", "")
        config.is_active = True
    else:
        config = TelegramConfig(
            tenant_id=user["tenant_id"],
            bot_token=bot_token,
            bot_username=bot_info.get("username", ""),
        )
        db.add(config)
        await db.flush()

    # 수신자 추가 (중복 방지)
    existing = await db.execute(
        select(TelegramRecipient).where(
            TelegramRecipient.config_id == config.id,
            TelegramRecipient.chat_id == chat_id,
        )
    )
    if not existing.scalar_one_or_none():
        db.add(TelegramRecipient(
            config_id=config.id,
            tenant_id=user["tenant_id"],
            chat_id=chat_id,
            name="기본 수신자",
        ))

    return {
        "message": "텔레그램봇이 연결되었습니다",
        "bot_name": bot_info.get("first_name", ""),
        "bot_username": bot_info.get("username", ""),
    }


# ──────── Recipients (수신자 관리) ──────────

@router.get("/recipients")
async def list_recipients(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """수신자 목록."""
    config = await _get_config(db, user["tenant_id"])
    if not config:
        return {"bot_connected": False, "recipients": []}

    recipients = (await db.execute(
        select(TelegramRecipient).where(
            TelegramRecipient.config_id == config.id,
        ).order_by(TelegramRecipient.created_at)
    )).scalars().all()

    return {
        "bot_connected": True,
        "bot_username": config.bot_username,
        "recipients": [
            {
                "id": str(r.id),
                "chat_id": r.chat_id,
                "name": r.name,
                "chat_type": r.chat_type,
                "is_active": r.is_active,
                "receive_news": r.receive_news,
                "receive_briefing": r.receive_briefing,
                "receive_alert": r.receive_alert,
            }
            for r in recipients
        ],
    }


@router.post("/recipients")
async def add_recipient(
    req: RecipientAddRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """수신자 추가 — 개인/그룹 가능."""
    config = await _get_config(db, user["tenant_id"])
    if not config:
        raise HTTPException(status_code=400, detail="먼저 봇을 연결하세요")

    # 중복 확인
    existing = await db.execute(
        select(TelegramRecipient).where(
            TelegramRecipient.config_id == config.id,
            TelegramRecipient.chat_id == req.chat_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 등록된 수신자입니다")

    # 채팅 ID로 메시지 보내서 유효성 확인
    bot = TelegramBot(config.bot_token, req.chat_id)
    success = await bot.send_message(
        f"✅ ElectionPulse에 수신자로 등록되었습니다.\n이름: {req.name}\n앞으로 분석 보고서를 받게 됩니다."
    )
    if not success:
        raise HTTPException(
            status_code=400,
            detail="메시지 전송 실패 — 봇에게 먼저 /start를 보내거나, 그룹에 봇을 추가하세요",
        )

    recipient = TelegramRecipient(
        config_id=config.id,
        tenant_id=user["tenant_id"],
        chat_id=req.chat_id,
        name=req.name,
        chat_type=req.chat_type,
        receive_news=req.receive_news,
        receive_briefing=req.receive_briefing,
        receive_alert=req.receive_alert,
    )
    db.add(recipient)
    await db.flush()

    return {"message": f"수신자 '{req.name}'이 추가되었습니다", "id": str(recipient.id)}


@router.put("/recipients/{recipient_id}")
async def update_recipient(
    recipient_id: UUID,
    req: RecipientUpdateRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """수신자 설정 변경."""
    result = await db.execute(
        select(TelegramRecipient).where(
            TelegramRecipient.id == recipient_id,
            TelegramRecipient.tenant_id == user["tenant_id"],
        )
    )
    recipient = result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="수신자를 찾을 수 없습니다")

    update = req.model_dump(exclude_unset=True)
    for k, v in update.items():
        setattr(recipient, k, v)

    return {"message": "수정 완료"}


@router.delete("/recipients/{recipient_id}", status_code=204)
async def delete_recipient(
    recipient_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """수신자 삭제."""
    result = await db.execute(
        select(TelegramRecipient).where(
            TelegramRecipient.id == recipient_id,
            TelegramRecipient.tenant_id == user["tenant_id"],
        )
    )
    recipient = result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="수신자를 찾을 수 없습니다")
    await db.delete(recipient)


# ──────── Status / Test / Briefing ──────────

@router.get("/status")
async def telegram_status(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """텔레그램 연결 상태."""
    config = await _get_config(db, user["tenant_id"])
    if not config:
        return {"connected": False, "message": "텔레그램봇이 연결되지 않았습니다"}

    recipients = (await db.execute(
        select(TelegramRecipient).where(TelegramRecipient.config_id == config.id, TelegramRecipient.is_active == True)
    )).scalars().all()

    return {
        "connected": config.is_active,
        "bot_username": config.bot_username,
        "recipient_count": len(recipients),
        "last_message": config.last_message_at.isoformat() if config.last_message_at else None,
    }


@router.post("/test")
async def send_test(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """모든 활성 수신자에게 테스트 메시지."""
    config = await _get_config(db, user["tenant_id"])
    if not config:
        raise HTTPException(status_code=404, detail="봇을 먼저 연결하세요")

    recipients = (await db.execute(
        select(TelegramRecipient).where(
            TelegramRecipient.config_id == config.id, TelegramRecipient.is_active == True,
        )
    )).scalars().all()

    if not recipients:
        raise HTTPException(status_code=400, detail="수신자를 추가하세요")

    sent = 0
    for r in recipients:
        bot = TelegramBot(config.bot_token, r.chat_id)
        ok = await bot.send_message(
            f"✅ ElectionPulse 테스트\n수신자: {r.name}\n봇이 정상 연결되었습니다!"
        )
        if ok:
            sent += 1

    return {"message": f"테스트 메시지 발송: {sent}/{len(recipients)}명"}


@router.post("/send-briefing")
async def send_briefing(
    briefing_type: str = "daily",
    user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """브리핑 보고서를 모든 수신자에게 발송."""
    from app.telegram_service.reporter import send_briefing_report

    election = (await db.execute(
        select(Election).where(Election.tenant_id == user["tenant_id"], Election.is_active == True)
    )).scalar_one_or_none()
    if not election:
        raise HTTPException(status_code=404, detail="활성 선거가 없습니다")

    report = await send_briefing_report(db, user["tenant_id"], str(election.id), briefing_type)
    if not report:
        raise HTTPException(status_code=500, detail="발송 실패 — 텔레그램 설정 확인")

    return {"message": f"{briefing_type} 브리핑 발송 완료", "preview": report[:500]}


# ──────── Helper ──────────

async def _get_config(db: AsyncSession, tenant_id: str):
    result = await db.execute(
        select(TelegramConfig).where(TelegramConfig.tenant_id == tenant_id)
    )
    return result.scalar_one_or_none()
