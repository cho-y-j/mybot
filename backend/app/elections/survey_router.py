"""
ElectionPulse - 여론조사 관리 API
질문지 + 결과 + 분석 — 질문에 따라 결과가 다름을 반영
"""
from uuid import UUID
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.elections.models import Survey, SurveyQuestion
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
    """여론조사 목록 — 같은 지역 + 같은 선거 유형 + 후보 이름 매칭."""
    from sqlalchemy import or_, and_
    from app.elections.models import Election
    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
    if not election:
        return {"surveys": [], "total": 0}

    tid = user["tenant_id"]
    etype = election.election_type
    region = election.region_sido

    # 조건: (직접 등록) OR (같은 지역의 모든 선거 유형 — 도지사/시장/교육감/도의원 등 정치 지형 공유)
    # 같은 충북 안에서 도지사 여론조사는 시장 캠프에도 핵심 자료
    # 미분류(election_type/region NULL)는 전국 정당 지지율 데이터이므로 제외
    conditions = [and_(
        Survey.tenant_id == tid,
        Survey.election_type.is_not(None),
        Survey.region_sido.is_not(None),
    )]
    if region:
        conditions.append(Survey.region_sido == region)
    survey_q = select(Survey).where(or_(*conditions))

    # 후보 이름으로 추가 필터 (후보 이름이 results에 포함되어야)
    from app.elections.models import Candidate
    cands = (await db.execute(
        select(Candidate.name).where(Candidate.election_id == election_id, Candidate.enabled == True)
    )).scalars().all()

    all_surveys = (await db.execute(
        survey_q.order_by(Survey.survey_date.desc()).limit(200)
    )).scalars().all()

    # 필터 룰:
    # - 직접 등록한 여론조사: 무조건 통과
    # - 다른 election_type (참고): 같은 지역이면 무조건 통과
    # - 같은 election_type:
    #     · results 비어있음 (NESDC 메타데이터만) → 같은 지역이면 통과
    #     · results 있음 → 후보 이름 매칭으로 관련성 검증
    surveys = []
    for s in all_surveys:
        if str(s.tenant_id) == str(tid):
            surveys.append(s)
        elif s.election_type and s.election_type != etype:
            surveys.append(s)
        else:
            # 같은 선거 유형
            results_dict = s.results if isinstance(s.results, dict) else {}
            if not results_dict:
                # 결과 미입력(메타만) — 같은 지역이면 표시
                surveys.append(s)
            else:
                r_str = str(results_dict)
                if cands and any(cn in r_str for cn in cands):
                    surveys.append(s)
        if len(surveys) >= 100:
            break

    # 질문 수를 한 번에 조회 (N+1 방지)
    from sqlalchemy import func as sqla_func
    q_counts_result = await db.execute(
        select(SurveyQuestion.survey_id, sqla_func.count().label("cnt"))
        .group_by(SurveyQuestion.survey_id)
    )
    q_counts = {str(row.survey_id): row.cnt for row in q_counts_result}

    elec_sigungu = election.region_sigungu  # SSW='청주시' 등
    items = []
    for s in surveys:
        # 본인 선거 판정:
        # - 같은 election_type AND
        # - (election의 sigungu가 없으면 광역 → 같은 type 모두 본인) OR
        # - (election의 sigungu와 survey sigungu 일치) OR
        # - (survey sigungu가 없으면 광역 단위 — 같은 type이면 본인 참고)
        is_own = False
        if s.election_type == etype:
            if not elec_sigungu:
                is_own = True  # 광역 (도지사 등)
            elif not s.region_sigungu:
                is_own = False  # 광역 단위 survey는 시·군 캠프엔 참고
            else:
                is_own = (s.region_sigungu == elec_sigungu)
        items.append({
            "id": str(s.id),
            "org": s.survey_org,
            "date": s.survey_date.isoformat() if s.survey_date else None,
            "method": s.method,
            "sample_size": s.sample_size,
            "margin_of_error": s.margin_of_error,
            "election_type": s.election_type,
            "region_sido": s.region_sido,
            "region_sigungu": s.region_sigungu,
            "source_url": s.source_url,
            "is_own_election": is_own,
            "results": s.results if isinstance(s.results, dict) else {},
            "question_count": q_counts.get(str(s.id), 0),
        })

    return {"count": len(items), "total": len(items), "surveys": items}


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
    중복 방지: 같은 기관 + 날짜 + 선거 조합은 거부.
    """
    from sqlalchemy import and_

    tid = user["tenant_id"]
    survey_date_parsed = date.fromisoformat(req.survey_date)

    # 중복 체크
    existing = (await db.execute(
        select(Survey).where(and_(
            Survey.tenant_id == tid,
            Survey.election_id == election_id,
            Survey.survey_org == req.survey_org,
            Survey.survey_date == survey_date_parsed,
        ))
    )).scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"이미 등록된 여론조사입니다: {req.survey_org} {req.survey_date}",
        )

    # 첫 번째 질문의 결과를 메인 결과로
    main_results = req.questions[0].results if req.questions else {}

    # ORM으로 Survey 생성
    survey = Survey(
        tenant_id=tid,
        election_id=election_id,
        survey_org=req.survey_org,
        survey_date=survey_date_parsed,
        sample_size=req.sample_size,
        margin_of_error=req.margin_of_error,
        method=req.method,
        results=main_results,
        election_type=req.election_type,
        region_sido=req.region_sido,
    )
    db.add(survey)
    await db.flush()

    # 질문지 저장 (ORM)
    for i, q in enumerate(req.questions, 1):
        db.add(SurveyQuestion(
            survey_id=survey.id,
            tenant_id=tid,
            question_number=i,
            question_type=q.question_type,
            question_text=q.question_text,
            condition_text=q.condition_text,
            results=q.results,
            sample_size=q.sample_size,
            notes=q.notes,
        ))

    return {
        "id": str(survey.id),
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
        select(SurveyQuestion)
        .where(SurveyQuestion.survey_id == survey_id)
        .order_by(SurveyQuestion.question_number)
    )).scalars().all()

    # 교차분석 데이터
    from app.elections.models import SurveyCrosstab
    from collections import defaultdict
    crosstabs_raw = (await db.execute(
        select(SurveyCrosstab).where(SurveyCrosstab.survey_id == survey_id)
    )).scalars().all()

    crosstabs = defaultdict(lambda: defaultdict(dict))
    for ct in crosstabs_raw:
        crosstabs[ct.dimension][ct.segment][ct.candidate] = ct.value

    crosstab_data = {}
    for dim, segments in crosstabs.items():
        crosstab_data[dim] = [
            {"segment": seg, "candidates": dict(cands)}
            for seg, cands in segments.items()
        ]

    return {
        "survey": {
            "id": str(survey.id),
            "org": survey.survey_org,
            "date": survey.survey_date.isoformat() if survey.survey_date else None,
            "method": survey.method,
            "sample_size": survey.sample_size,
            "margin_of_error": survey.margin_of_error,
            "results": survey.results if isinstance(survey.results, dict) else {},
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
        "crosstabs": crosstab_data,
        "has_crosstabs": len(crosstabs_raw) > 0,
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
    # 최근 여론조사의 질문들 (ORM)
    questions_result = await db.execute(
        select(SurveyQuestion, Survey.survey_org, Survey.survey_date, Survey.sample_size)
        .join(Survey, SurveyQuestion.survey_id == Survey.id)
        .where(Survey.tenant_id == user["tenant_id"])
        .order_by(Survey.survey_date.desc())
        .limit(50)
    )
    questions = questions_result.all()

    # 질문 유형별 그룹핑
    by_type: dict = {}
    for sq, survey_org, survey_date, sample_size in questions:
        qtype = sq.question_type or "simple"
        if qtype not in by_type:
            by_type[qtype] = []
        by_type[qtype].append({
            "question": sq.question_text,
            "condition": sq.condition_text,
            "results": sq.results if isinstance(sq.results, dict) else {},
            "org": survey_org,
            "date": survey_date.isoformat() if survey_date else None,
            "sample": sample_size,
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
