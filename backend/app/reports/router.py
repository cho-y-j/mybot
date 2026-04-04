"""
ElectionPulse - Reports API
보고서 생성, 조회, 텔레그램 발송
"""
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
    user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """일일 보고서 생성 + 텔레그램 발송. use_ai=True면 AI 분석 포함."""
    import uuid

    tid = user["tenant_id"]

    # AI 보고서 우선 시도
    report_text = ""
    ai_generated = False
    if use_ai:
        try:
            from app.reports.ai_report import generate_ai_report
            result = await generate_ai_report(db, tid, str(election_id))
            report_text = result.get("text", "")
            ai_generated = result.get("ai_generated", False)
        except Exception:
            report_text = ""

    # AI 실패시 기존 데이터 기반 보고서
    if not report_text:
        from app.reports.generator import generate_daily_report
        result = await generate_daily_report(db, tid, str(election_id))
        report_text = result["text"]

    # DB 저장
    report = Report(
        id=uuid.uuid4(),
        tenant_id=tid,
        election_id=election_id,
        report_type="ai_daily" if ai_generated else "daily",
        title=report_text.split("\n")[0] if report_text else "일일 보고서",
        content_text=report_text,
        report_date=date.today(),
        sent_via_telegram=False,
    )
    db.add(report)

    # 텔레그램 발송
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
        "message": f"일일 보고서 생성 완료" + (f" (텔레그램 {sent}명 발송)" if sent else ""),
        "report_id": str(report.id),
        "ai_generated": ai_generated,
        "telegram_sent": sent,
        "preview": report_text[:500],
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
