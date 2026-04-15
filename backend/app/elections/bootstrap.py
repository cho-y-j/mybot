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
    plan: str = "full",
    homepage_code: str | None = None,
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

    # 5. 홈페이지(myhome) 사용자 자동 프로비저닝
    # - plan=analysis_only면 스킵
    # - 같은 DB의 homepage 스키마에 User row 생성
    # - code는 tenant_id 앞 8자리 (사용자가 나중에 설정 페이지에서 변경 가능)
    # - 로그인은 mybot SSO만 허용 (password_hash는 placeholder)
    if plan == "analysis_only":
        result["homepage"] = {"status": "skipped", "reason": "plan=analysis_only"}
        logger.info("bootstrap_campaign_complete", election_id=election_id, plan=plan,
                    error_count=len(result["errors"]))
        return result
    try:
        from sqlalchemy import text as sql_text
        # tenant 기본 정보 + 오너 이메일(users에서 owner role 1명)
        t_row = (await db.execute(sql_text(
            "SELECT t.name, (SELECT u.email FROM users u WHERE u.tenant_id = t.id AND u.role='owner' LIMIT 1) "
            "FROM tenants t WHERE t.id = cast(:tid as uuid)"
        ), {"tid": tenant_id})).first()
        tenant_name = t_row[0] if t_row else "캠프"
        tenant_email = t_row[1] if t_row else None

        # 사용자 지정 code가 있고 유효/미사용이면 그것, 아니면 tenant_id 앞 8자
        default_code = str(tenant_id).replace("-", "")[:8]
        if homepage_code:
            req_code = homepage_code.lower().strip()
            from app.homepage_sso.router import CODE_PATTERN, RESERVED_CODES
            valid = (CODE_PATTERN.match(req_code) and req_code not in RESERVED_CODES)
            if valid:
                dup = (await db.execute(sql_text(
                    "SELECT 1 FROM homepage.users WHERE code = :c"
                ), {"c": req_code})).first()
                if not dup:
                    default_code = req_code
        exists = (await db.execute(sql_text(
            "SELECT id FROM homepage.users WHERE tenant_id = cast(:tid as uuid)"
        ), {"tid": tenant_id})).first()

        if not exists:
            new_row = (await db.execute(sql_text("""
                INSERT INTO homepage.users
                  (code, name, email, password_hash, template_type, template_theme,
                   is_active, tenant_id, election_id, created_at, updated_at)
                VALUES
                  (:code, :name, :email, :pwd, 'election', 'default',
                   true, cast(:tid as uuid), cast(:eid as uuid), NOW(), NOW())
                RETURNING id
            """), {
                "code": default_code,
                "name": tenant_name,
                "email": tenant_email,
                "pwd": "SSO_ONLY",  # homepage 직접 로그인 차단, mybot 토큰으로만 접근
                "tid": tenant_id,
                "eid": election_id,
            })).first()
            homepage_user_id = new_row[0] if new_row else None
            await db.flush()
            result["homepage"] = {"status": "created", "code": default_code,
                                  "url": f"/{default_code}"}
            logger.info("bootstrap_homepage_created", tenant=tenant_id, code=default_code)
        else:
            homepage_user_id = exists[0]
            result["homepage"] = {"status": "exists"}

        # 5b. 홈페이지 자동 채우기 — NEC 데이터 + 정당별 컬러 + AI 소개문
        if homepage_user_id:
            try:
                from app.elections.homepage_autofill import auto_fill_homepage
                fill = await auto_fill_homepage(db, tenant_id, election_id, homepage_user_id)
                await db.flush()
                result["homepage_autofill"] = fill
                logger.info("bootstrap_homepage_filled", tenant=tenant_id, result=fill)
            except Exception as af_err:
                result["errors"].append(f"homepage_autofill: {str(af_err)[:200]}")
                logger.warning("bootstrap_autofill_failed", error=str(af_err)[:300])
    except Exception as e:
        result["errors"].append(f"homepage: {str(e)[:200]}")
        logger.warning("bootstrap_homepage_failed", error=str(e))
        result["homepage"] = {"status": "failed", "reason": str(e)[:200]}

    logger.info("bootstrap_campaign_complete", election_id=election_id,
                history=result["history_analysis"], survey=result["survey_analysis"],
                report=result["first_report"], error_count=len(result["errors"]))
    return result
