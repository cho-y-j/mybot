"""
ElectionPulse - Reports API
보고서 생성, 조회, 텔레그램 발송, PDF 다운로드
"""
import os
import uuid
from uuid import UUID
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
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
            result = await generate_ai_report(db, tid, str(election_id), report_type=briefing_type)
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

    # 3. PDF 생성
    pdf_path = None
    try:
        from app.reports.pdf_generator import generate_report_pdf
        pdf_meta = result.get("pdf_meta", {}) if use_ai and result else {}
        election_obj = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
        d_day = (election_obj.election_date - date.today()).days if election_obj and election_obj.election_date else 0
        pdf_path = generate_report_pdf(
            report_text=report_text,
            election_name=election_obj.name if election_obj else "",
            report_date=date.today().isoformat(),
            report_type=briefing_type,
            our_candidate=pdf_meta.get("our_candidate", ""),
            d_day=d_day,
            candidates_data=pdf_meta.get("candidates_data"),
        )
        if pdf_path:
            logger.info("report_pdf_generated", path=pdf_path)
    except Exception as e:
        logger.warning("report_pdf_failed", error=str(e)[:200])

    # 4. DB 저장
    type_map = {
        "morning": "morning_brief",
        "afternoon": "afternoon_brief",
        "daily": "daily",
        "weekly": "weekly",
    }
    report = Report(
        id=uuid.uuid4(),
        tenant_id=tid,
        election_id=election_id,
        report_type=("ai_" + type_map.get(briefing_type, "daily")) if ai_generated else type_map.get(briefing_type, "daily"),
        title=report_text.split("\n")[0] if report_text else f"{briefing_type} 보고서",
        content_text=report_text,
        file_path_pdf=pdf_path,
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


class ReportUpdateRequest(BaseModel):
    content_text: str
    status: str = "confirmed"


@router.put("/{election_id}/{report_id}")
async def update_report(
    election_id: UUID,
    report_id: UUID,
    body: ReportUpdateRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """보고서 수정/확정 — 사용자가 편집한 내용 저장 + PDF 재생성."""
    result = await db.execute(
        select(Report).where(Report.id == report_id, Report.tenant_id == user["tenant_id"])
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404)

    report.content_text = body.content_text

    # 확정 시 PDF 재생성
    if body.status == "confirmed":
        try:
            from app.reports.pdf_generator import generate_report_pdf
            election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
            d_day = (election.election_date - date.today()).days if election and election.election_date else 0
            pdf_path = generate_report_pdf(
                report_text=body.content_text,
                election_name=election.name if election else "",
                report_date=report.report_date.isoformat() if report.report_date else "",
                report_type=report.report_type or "daily",
                d_day=d_day,
            )
            if pdf_path:
                report.file_path_pdf = pdf_path
        except Exception:
            pass

    await db.commit()
    return {"message": "보고서 확정 저장 완료", "id": str(report.id)}


@router.get("/{election_id}/{report_id}/download-pdf")
async def download_report_pdf(
    election_id: UUID,
    report_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """보고서 PDF 다운로드."""
    from fastapi.responses import FileResponse

    result = await db.execute(
        select(Report).where(Report.id == report_id, Report.tenant_id == user["tenant_id"])
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404)

    # PDF가 이미 생성되어 있으면 반환
    if report.file_path_pdf and os.path.exists(report.file_path_pdf):
        return FileResponse(report.file_path_pdf, media_type="application/pdf",
                            filename=f"report_{report.report_date}.pdf")

    # 아니면 실시간 생성
    from app.reports.pdf_generator import generate_report_pdf

    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
    election_name = election.name if election else ""
    d_day = (election.election_date - date.today()).days if election and election.election_date else 0

    pdf_path = generate_report_pdf(
        report_text=report.content_text or "",
        election_name=election_name,
        report_date=report.report_date.isoformat() if report.report_date else "",
        report_type=report.report_type or "daily",
        d_day=d_day,
    )

    if not pdf_path:
        raise HTTPException(status_code=500, detail="PDF 생성 실패 (fpdf2 설치 필요: pip install fpdf2)")

    # DB에 PDF 경로 저장
    report.file_path_pdf = pdf_path
    await db.flush()

    return FileResponse(pdf_path, media_type="application/pdf",
                        filename=f"ElectionPulse_{report.report_date}_{report.report_type}.pdf")


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


@router.delete("/{election_id}/{report_id}")
async def delete_report(
    election_id: UUID,
    report_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """보고서 삭제."""
    tid = user["tenant_id"]
    report = (await db.execute(
        select(Report).where(Report.id == report_id, Report.tenant_id == tid)
    )).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404)

    # PDF 파일도 삭제
    if report.file_path_pdf:
        try:
            os.remove(report.file_path_pdf)
        except Exception:
            pass

    await db.delete(report)
    await db.commit()
    return {"message": "보고서가 삭제되었습니다."}
