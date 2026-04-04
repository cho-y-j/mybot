"""
ElectionPulse - 여론조사 관리 API
질문지 + 결과 + 분석 — 질문에 따라 결과가 다름을 반영
"""
from uuid import UUID
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
import json

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.elections.models import Survey
from datetime import date

router = APIRouter()


# ──── Schemas ────

class QuestionInput(BaseModel):
    question_text: str           # "교육감 후보 중 누구를 지지하십니까?"
    question_type: str = "simple"  # simple | conditional | issue_based | matchup
    condition_text: Optional[str] = None  # "진보 단일 후보라면?"
    results: dict = {}           # {"김진균": 25.3, "윤건영": 32.1, ...}
    sample_size: Optional[int] = None
    notes: Optional[str] = None


class SurveyCreate(BaseModel):
    survey_org: str              # "한국갤럽"
    client_org: Optional[str] = None  # "MBC"
    survey_date: str             # "2026-04-01"
    method: Optional[str] = None   # "무선전화면접(100)"
    sample_size: Optional[int] = None
    margin_of_error: Optional[float] = None
    election_type: Optional[str] = None  # "superintendent"
    region_sido: Optional[str] = None    # "충청북도"
    questions: list[QuestionInput] = []  # 질문지 + 결과


# ──── API ────

@router.get("/{election_id}/surveys")
async def list_surveys(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """여론조사 목록 (질문 수 포함)."""
    from sqlalchemy import or_
    # 해당 테넌트 + 공공데이터 중 관련 있는 것만
    # 1) 직접 등록한 것 (tenant_id 일치)
    # 2) 공공데이터 중 해당 선거/지역 (election_type + region)
    from app.elections.models import Election
    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()

    # 해당 선거 관련 여론조사 우선, 전국 정당지지율은 별도
    from app.elections.models import Election
    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()

    # 해당 테넌트 + 충북 관련 공공데이터 전체
    result = await db.execute(
        select(Survey).where(
            or_(
                Survey.tenant_id == user["tenant_id"],
                Survey.source_url == 'chungbuk_prototype',
                Survey.source_url.like('pdf/%충북%'),
                Survey.source_url.like('pdf/%리얼미터%'),
            )
        ).order_by(Survey.survey_date.desc()).limit(50)
    )
    surveys = result.scalars().all()

    items = []
    for s in surveys:
        # 질문 수 조회
        q_count = (await db.execute(
            text("SELECT COUNT(*) FROM survey_questions WHERE survey_id = :sid"),
            {"sid": str(s.id)},
        )).scalar() or 0

        items.append({
            "id": str(s.id),
            "org": s.survey_org,
            "date": s.survey_date.isoformat() if s.survey_date else None,
            "method": s.method,
            "sample_size": s.sample_size,
            "margin_of_error": s.margin_of_error,
            "results": s.results if isinstance(s.results, dict) else {},
            "question_count": q_count,
        })

    return {"count": len(items), "surveys": items}


@router.post("/{election_id}/surveys", status_code=201)
async def create_survey(
    election_id: UUID,
    req: SurveyCreate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    여론조사 등록 (질문지 포함).
    같은 조사에 여러 질문 → 각 질문마다 다른 결과.
    """
    import uuid

    # 메인 여론조사 레코드
    survey_id = str(uuid.uuid4())

    # 첫 번째 질문의 결과를 메인 결과로
    main_results = req.questions[0].results if req.questions else {}

    await db.execute(text("""
        INSERT INTO surveys (id, tenant_id, election_id, survey_org, survey_date,
            sample_size, margin_of_error, method, results)
        VALUES (:id, :tid, :eid, :org, :sd, :sample, :moe, :method, :results)
    """), {
        "id": survey_id,
        "tid": user["tenant_id"],
        "eid": str(election_id),
        "org": req.survey_org,
        "sd": date.fromisoformat(req.survey_date),
        "sample": req.sample_size,
        "moe": req.margin_of_error,
        "method": req.method,
        "results": json.dumps(main_results, ensure_ascii=False),
    })

    # 질문지 저장
    for i, q in enumerate(req.questions, 1):
        await db.execute(text("""
            INSERT INTO survey_questions (id, survey_id, tenant_id, question_number,
                question_type, question_text, condition_text, results, sample_size, notes)
            VALUES (:id, :sid, :tid, :num, :qtype, :qtext, :cond, :results, :sample, :notes)
        """), {
            "id": str(uuid.uuid4()),
            "sid": survey_id,
            "tid": user["tenant_id"],
            "num": i,
            "qtype": q.question_type,
            "qtext": q.question_text,
            "cond": q.condition_text,
            "results": json.dumps(q.results, ensure_ascii=False),
            "sample": q.sample_size,
            "notes": q.notes,
        })

    return {
        "id": survey_id,
        "message": f"여론조사 등록 완료 (질문 {len(req.questions)}개)",
    }


@router.get("/{election_id}/surveys/{survey_id}")
async def get_survey_detail(
    election_id: UUID,
    survey_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """여론조사 상세 — 모든 질문 + 결과."""
    survey = (await db.execute(
        select(Survey).where(Survey.id == survey_id)
    )).scalar_one_or_none()

    if not survey:
        raise HTTPException(status_code=404)

    questions = (await db.execute(
        text("SELECT * FROM survey_questions WHERE survey_id = :sid ORDER BY question_number"),
        {"sid": str(survey_id)},
    )).fetchall()

    return {
        "survey": {
            "id": str(survey.id),
            "org": survey.survey_org,
            "date": survey.survey_date.isoformat() if survey.survey_date else None,
            "method": survey.method,
            "sample_size": survey.sample_size,
            "margin_of_error": survey.margin_of_error,
        },
        "questions": [
            {
                "number": q.question_number,
                "type": q.question_type,
                "text": q.question_text,
                "condition": q.condition_text,
                "results": q.results if isinstance(q.results, dict) else {},
                "sample_size": q.sample_size,
                "notes": q.notes,
            }
            for q in questions
        ],
    }


@router.delete("/{election_id}/surveys/{survey_id}", status_code=204)
async def delete_survey(
    election_id: UUID,
    survey_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """여론조사 삭제."""
    survey = (await db.execute(
        select(Survey).where(Survey.id == survey_id, Survey.tenant_id == user["tenant_id"])
    )).scalar_one_or_none()
    if not survey:
        raise HTTPException(status_code=404)
    await db.delete(survey)


@router.get("/{election_id}/surveys/compare")
async def compare_survey_questions(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    질문 유형별 여론조사 비교.
    같은 질문 → 시계열 비교
    다른 질문 → 조건에 따른 결과 차이 비교
    """
    # 최근 여론조사의 질문들
    questions = (await db.execute(text("""
        SELECT sq.question_type, sq.question_text, sq.condition_text, sq.results,
               s.survey_org, s.survey_date, s.sample_size
        FROM survey_questions sq
        JOIN surveys s ON sq.survey_id = s.id
        WHERE s.tenant_id = :tid
        ORDER BY s.survey_date DESC
        LIMIT 50
    """), {"tid": user["tenant_id"]})).fetchall()

    # 질문 유형별 그룹핑
    by_type: dict = {}
    for q in questions:
        qtype = q.question_type or "simple"
        if qtype not in by_type:
            by_type[qtype] = []
        by_type[qtype].append({
            "question": q.question_text,
            "condition": q.condition_text,
            "results": q.results if isinstance(q.results, dict) else {},
            "org": q.survey_org,
            "date": q.survey_date.isoformat() if q.survey_date else None,
            "sample": q.sample_size,
        })

    type_labels = {
        "simple": "단순 지지율",
        "conditional": "조건부 (단일화 등)",
        "issue_based": "이슈별 지지",
        "matchup": "양자 대결",
    }

    return {
        "question_types": {
            qtype: {
                "label": type_labels.get(qtype, qtype),
                "count": len(items),
                "questions": items,
            }
            for qtype, items in by_type.items()
        },
    }
