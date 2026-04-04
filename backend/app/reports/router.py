"""
ElectionPulse - Reports API
보고서 생성, 조회, 텔레그램 발송
"""
import uuid
from uuid import UUID
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.elections.models import Report, Election

router = APIRouter()


@router.get("/{election_id}")
async def list_reports(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """보고서 목록."""
    result = await db.execute(
        select(Report).where(
            Report.tenant_id == user["tenant_id"],
            Report.election_id == election_id,
        ).order_by(Report.report_date.desc()).limit(30)
    )
    return [
        {
            "id": str(r.id),
            "type": r.report_type,
            "title": r.title,
            "date": r.report_date.isoformat(),
            "sent_telegram": r.sent_via_telegram,
            "created_at": r.created_at.isoformat(),
        }
        for r in result.scalars().all()
    ]


@router.post("/{election_id}/generate")
async def generate_report(
    election_id: UUID,
    send_telegram: bool = True,
    use_ai: bool = True,
    briefing_type: str = "daily",
    user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """
    보고서 생성 + 텔레그램 발송.
    briefing_type: morning | afternoon | daily
    use_ai=True면 AI 분석 포함.
    send_telegram=True면 모든 텔레그램 수신자에게 발송.
    """
    tid = user["tenant_id"]

    # 1. AI 보고서 우선 시도
    report_text = ""
    ai_generated = False
    if use_ai:
        try:
            from app.reports.ai_report import generate_ai_report
            result = await generate_ai_report(db, tid, str(election_id))
            report_text = result.get("text", "")
            ai_generated = result.get("ai_generated", False)
        except Exception as e:
            report_text = ""

    # 2. AI 실패시 브리핑 타입별 데이터 기반 보고서
    if not report_text:
        try:
            from app.telegram_service.reporter import generate_briefing_text
            report_text = await generate_briefing_text(
                db, tid, str(election_id), briefing_type,
            )
            if not report_text:
                # Final fallback
                from app.reports.generator import generate_daily_report
                result = await generate_daily_report(db, tid, str(election_id))
                report_text = result["text"]
        except Exception:
            from app.reports.generator import generate_daily_report
            result = await generate_daily_report(db, tid, str(election_id))
            report_text = result["text"]

    # 3. DB 저장
    type_map = {
        "morning": "morning_brief",
        "afternoon": "afternoon_brief",
        "daily": "daily",
    }
    report = Report(
        id=uuid.uuid4(),
        tenant_id=tid,
        election_id=election_id,
        report_type=("ai_" + type_map.get(briefing_type, "daily")) if ai_generated else type_map.get(briefing_type, "daily"),
        title=report_text.split("\n")[0] if report_text else f"{briefing_type} 보고서",
        content_text=report_text,
        report_date=date.today(),
        sent_via_telegram=False,
    )
    db.add(report)

    # 4. 텔레그램 발송
    sent = 0
    if send_telegram:
        try:
            from app.telegram_service.reporter import _send_to_all_recipients
            sent = await _send_to_all_recipients(db, tid, report_text, "briefing")
            if sent > 0:
                report.sent_via_telegram = True
                report.sent_at = datetime.now(timezone.utc)
        except Exception:
            pass

    await db.flush()

    return {
        "message": f"보고서 생성 완료" + (f" (텔레그램 {sent}명 발송)" if sent else ""),
        "report_id": str(report.id),
        "report_type": briefing_type,
        "ai_generated": ai_generated,
        "telegram_sent": sent,
        "preview": report_text[:500] if report_text else "",
        "full_text": report_text,
    }


@router.get("/{election_id}/{report_id}")
async def get_report(
    election_id: UUID,
    report_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """보고서 상세."""
    result = await db.execute(
        select(Report).where(Report.id == report_id, Report.tenant_id == user["tenant_id"])
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404)

    return {
        "id": str(report.id),
        "type": report.report_type,
        "title": report.title,
        "date": report.report_date.isoformat(),
        "content": report.content_text,
        "sent_telegram": report.sent_via_telegram,
    }


@router.post("/{election_id}/{report_id}/send-telegram")
async def send_report_to_telegram(
    election_id: UUID,
    report_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """기존 보고서를 텔레그램으로 재발송."""
    tid = user["tenant_id"]

    result = await db.execute(
        select(Report).where(Report.id == report_id, Report.tenant_id == tid)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404)

    from app.telegram_service.reporter import _send_to_all_recipients
    sent = await _send_to_all_recipients(db, tid, report.content_text, "briefing")

    if sent > 0:
        report.sent_via_telegram = True
        report.sent_at = datetime.now(timezone.utc)

    return {"message": f"텔레그램 {sent}명에게 발송 완료", "sent": sent}
