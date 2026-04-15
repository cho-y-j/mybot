"""
ElectionPulse - 캠프 자동 부트스트랩
신규 캠프가 생성되면 가능한 모든 분석/리포트를 자동 실행하여
대시보드/페이지가 첫 방문 시 이미 채워져 있도록 한다.

원칙 (feedback_auto_optimize 메모리):
- 사용자가 페이지마다 "비어있다" 라고 지적할 필요 없어야 함
- 데이터가 있으면 자동으로 차트/분석을 만들어 보여줘야 함
- 시장 단위 데이터가 부족하면 광역(도지사) 데이터로 fallback
"""
import uuid
from datetime import date

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


async def bootstrap_campaign(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
) -> dict:
    """
    캠프 자동 부트스트랩.

    실행 순서:
    1. 과거 선거 분석 (analyze_history_deep) → analysis_cache 저장
    2. 여론조사 분석 (analyze_survey_deep) → analysis_cache 저장
    3. AI 일일 리포트 생성 (generate_ai_report) → reports 테이블 저장

    각 단계는 독립적으로 try/except — 하나가 실패해도 나머지는 진행.
    이미 결과가 있으면 (캐시 hit) 빠르게 통과.
    """
    result = {
        "history_analysis": None,
        "survey_analysis": None,
        "first_report": None,
        "errors": [],
    }

    # 1. 과거 선거 분석
    try:
        from app.analysis.history_analyzer import analyze_history_deep
        hist = await analyze_history_deep(db, tenant_id, election_id)
        if hist.get("error"):
            result["history_analysis"] = {"status": "no_data", "message": hist["error"]}
        else:
            result["history_analysis"] = {
                "status": "ok",
                "elections_count": hist.get("elections_count", 0),
                "fallback_used": hist.get("fallback_used"),
            }
        logger.info("bootstrap_history_done", election_id=election_id, status=result["history_analysis"]["status"])
    except Exception as e:
        msg = f"history_analysis: {str(e)[:200]}"
        result["errors"].append(msg)
        logger.warning("bootstrap_history_failed", error=str(e))

    # 2. 여론조사 분석
    try:
        from app.analysis.survey_analyzer import analyze_survey_deep
        sur = await analyze_survey_deep(db, tenant_id, election_id)
        if sur.get("error"):
            result["survey_analysis"] = {"status": "no_data", "message": sur.get("error")}
        else:
            result["survey_analysis"] = {
                "status": "ok",
                "total_surveys": sur.get("total_surveys", 0),
            }
        logger.info("bootstrap_survey_done", election_id=election_id, status=result["survey_analysis"]["status"])
    except Exception as e:
        msg = f"survey_analysis: {str(e)[:200]}"
        result["errors"].append(msg)
        logger.warning("bootstrap_survey_failed", error=str(e))

    # 3. 첫 AI 리포트
    try:
        from app.reports.ai_report import generate_ai_report
        from app.elections.models import Report

        report_result = await generate_ai_report(db, tenant_id, election_id, report_type="daily")
        report_text = report_result.get("text", "")
        ai_generated = report_result.get("ai_generated", False)

        if report_text:
            report = Report(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                election_id=election_id,
                report_type=("ai_daily" if ai_generated else "daily"),
                title=report_text.split("\n")[0] if report_text else "첫 일일 보고서",
                content_text=report_text,
                report_date=date.today(),
                sent_via_telegram=False,
            )
            db.add(report)
            await db.flush()
            result["first_report"] = {
                "status": "ok",
                "ai_generated": ai_generated,
                "report_id": str(report.id),
                "length": len(report_text),
            }
            logger.info("bootstrap_report_done", election_id=election_id, ai=ai_generated, len=len(report_text))
        else:
            result["first_report"] = {"status": "empty"}
    except Exception as e:
        msg = f"first_report: {str(e)[:200]}"
        result["errors"].append(msg)
        logger.warning("bootstrap_report_failed", error=str(e))

    # 4. RAG 벡터 임베딩 (수집 + 분석 + 보고서 모두 임베딩 가능)
    try:
        from app.services.embedding_service import embed_existing_data
        emb_result = await embed_existing_data(db, tenant_id, election_id)
        result["embeddings"] = emb_result
        logger.info("bootstrap_embeddings_done", election_id=election_id, result=emb_result)
    except Exception as e:
        result["errors"].append(f"embeddings: {str(e)[:200]}")
        logger.warning("bootstrap_embeddings_failed", error=str(e))
        result["embeddings"] = {"status": "failed"}

    logger.info("bootstrap_campaign_complete", election_id=election_id,
                history=result["history_analysis"], survey=result["survey_analysis"],
                report=result["first_report"], error_count=len(result["errors"]))
    return result
