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
    """
    여론조사 목록 — 후보 이름 기반 검색.
    1) 우리 tenant가 등록한 모든 여론조사
    2) 같은 지역(region_sido)의 모든 여론조사 (election_type 무관)
    3) 우리 후보 이름이 results에 포함된 모든 여론조사
    → 각 항목에 match_type 표시: 'candidate'(후보매칭) / 'region'(같은지역) / 'own'(직접등록)
    """
    from sqlalchemy import or_, and_, cast, String
    from app.elections.models import Election, Candidate

    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
    if not election:
        return {"surveys": [], "total": 0}

    tid = user["tenant_id"]
    etype = election.election_type
    region = election.region_sido

    # 등록된 후보 이름
    cands = (await db.execute(
        select(Candidate.name).where(Candidate.election_id == election_id, Candidate.enabled == True)
    )).scalars().all()

    # 넓게 조회: (우리 tenant) OR (같은 지역) OR (후보이름 포함)
    # 시장/군수/구청장은 시군구 단위, 도지사/교육감은 시도 단위
    sigungu = election.region_sigungu
    local_types = {'mayor', 'gun_head', 'gu_head'}  # 기초단체장
    conditions = [Survey.tenant_id == tid]
    if region:
        if etype in local_types and sigungu:
            # 기초단체장: 같은 시군구 OR 시군구 미지정(시도 전체 조사)
            conditions.append(and_(
                Survey.region_sido == region,
                or_(Survey.region_sigungu == sigungu, Survey.region_sigungu.is_(None))
            ))
        else:
            # 광역단체장/교육감: 같은 시도
            conditions.append(Survey.region_sido == region)
    # 후보 이름이 results에 포함된 여론조사 (JSONB text search)
    for cn in cands:
        conditions.append(cast(Survey.results, String).contains(cn))

    all_surveys = (await db.execute(
        select(Survey).where(or_(*conditions))
        .order_by(Survey.survey_date.desc())
        .limit(500)
    )).scalars().all()

    # 질문 수를 한 번에 조회 (N+1 방지)
    from sqlalchemy import func as sqla_func
    survey_ids = [s.id for s in all_surveys]
    q_counts = {}
    if survey_ids:
        q_counts_result = await db.execute(
            select(SurveyQuestion.survey_id, sqla_func.count().label("cnt"))
            .where(SurveyQuestion.survey_id.in_(survey_ids))
            .group_by(SurveyQuestion.survey_id)
        )
        q_counts = {str(row.survey_id): row.cnt for row in q_counts_result}

    items = []
    seen_ids = set()
    for s in all_surveys:
        sid = str(s.id)
        if sid in seen_ids:
            continue
        seen_ids.add(sid)

        # match_type 판정
        is_own = (str(s.tenant_id) == str(tid))
        r_str = str(s.results) if isinstance(s.results, dict) else ""
        has_our_candidate = bool(cands and any(cn in r_str for cn in cands))
        same_type = (s.election_type == etype) if s.election_type and etype else False

        if is_own:
            match_type = "own"
        elif has_our_candidate and same_type:
            match_type = "candidate"
        elif has_our_candidate:
            match_type = "candidate_other"  # 다른 유형이지만 후보명 포함
        elif s.election_type == etype:
            match_type = "same_type"
        else:
            match_type = "region"

        items.append({
            "id": sid,
            "org": s.survey_org,
            "client_org": getattr(s, 'client_org', None),
            "date": s.survey_date.isoformat() if s.survey_date else None,
            "method": s.method,
            "sample_size": s.sample_size,
            "margin_of_error": s.margin_of_error,
            "election_type": s.election_type,
            "region_sido": s.region_sido,
            "region_sigungu": s.region_sigungu,
            "source_url": getattr(s, 'source_url', None),
            "match_type": match_type,
            "has_our_candidate": has_our_candidate,
            "is_own_election": is_own or (has_our_candidate and same_type),
            "results": s.results if isinstance(s.results, dict) else {},
            "question_count": q_counts.get(sid, 0),
        })

    return {"count": len(items), "total": len(items), "surveys": items}


# ─── 2026-04-19: 여론조사 근본 재설계 ───
# 기존 문제: 같은 조사가 election_type별로 여러 surveys 레코드로 분산
#   예) 리얼미터 2026-03-22 충북 → superintendent 1건 + governor 3건 (실제론 1개 조사)
# 해결: API에서 org+date+region 기준 그룹핑 → 1개 조사 + 여러 질문 구조로 반환
# 우리 선거 vs 참고(다른 선거) 분리 + 각 질문의 후보 whitelist 추출
@router.get("/{election_id}/surveys-grouped")
async def list_surveys_grouped(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    조사 기관·날짜·지역 기준으로 그룹핑된 여론조사 목록.

    각 그룹(= 실제 1개 조사)에는 여러 질문(election_type별)이 포함.
    우리 선거의 질문에는 `has_our_candidate`, `our_rank`, `our_value` 태깅.
    프론트에서 "우리 선거" + "참고(선거별)" 2탭으로 렌더.
    """
    import re
    from app.elections.models import Election, Candidate

    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
    if not election:
        return {"groups": [], "our_election_type": None, "our_candidates": []}

    tid = user["tenant_id"]
    our_type = election.election_type
    region = election.region_sido
    sigungu = election.region_sigungu

    # 등록된 우리 후보 + 경쟁자
    our_cands = (await db.execute(
        select(Candidate).where(Candidate.election_id == election_id, Candidate.enabled == True)
    )).scalars().all()
    our_names = [c.name for c in our_cands]
    our_candidate_name = next((c.name for c in our_cands if c.is_our_candidate), None)

    # 지역 매칭: 기초단체장은 시군구, 광역은 시도만
    from sqlalchemy import or_, and_
    local_types = {"mayor", "gun_head", "gu_head"}
    conditions = [Survey.tenant_id == tid]
    if region:
        if our_type in local_types and sigungu:
            conditions.append(and_(
                Survey.region_sido == region,
                or_(Survey.region_sigungu == sigungu, Survey.region_sigungu.is_(None)),
            ))
        else:
            conditions.append(Survey.region_sido == region)

    rows = (await db.execute(
        select(Survey).where(or_(*conditions))
        .order_by(Survey.survey_date.desc())
        .limit(500)
    )).scalars().all()

    # 조사 기관명 정규화 (공백·괄호·접두어 제거)
    def norm_org(o: str) -> str:
        if not o:
            return ""
        return re.sub(r"[\s\(\)㈜(주)\[\]]+", "", o).lower()

    # 질문 단위로 정규화 (각 survey row → 1개 question)
    from collections import defaultdict
    groups: dict[tuple, dict] = {}

    for s in rows:
        key = (norm_org(s.survey_org or ""), s.survey_date, s.region_sido or "", s.region_sigungu or "")
        if key not in groups:
            groups[key] = {
                "group_key": f"{s.survey_org or ''}|{s.survey_date}|{s.region_sido or ''}|{s.region_sigungu or ''}",
                "survey_org": s.survey_org,
                "client_org": getattr(s, "client_org", None),
                "survey_date": s.survey_date.isoformat() if s.survey_date else None,
                "region_sido": s.region_sido,
                "region_sigungu": s.region_sigungu,
                "sample_size": s.sample_size,
                "margin_of_error": s.margin_of_error,
                "method": s.method,
                "questions": [],
                "is_our_election": False,
            }
        grp = groups[key]
        # 더 큰 sample_size 채택
        if s.sample_size and (not grp["sample_size"] or s.sample_size > grp["sample_size"]):
            grp["sample_size"] = s.sample_size

        # 질문 레벨 메타
        results = s.results if isinstance(s.results, dict) else {}
        # 단순 결과 dict {name: value} vs 중첩 {카테고리: {name: value}} 모두 지원
        flat: dict[str, float] = {}
        for k, v in (results or {}).items():
            if isinstance(v, (int, float)):
                flat[k] = float(v)
            elif isinstance(v, dict):
                # 중첩 무시 (복합 구조는 별도 처리 필요, Phase 3)
                pass

        # 우리 후보 매칭
        our_value = None
        our_rank = None
        has_ours = False
        if our_candidate_name and flat:
            # 이름 포함 매칭 (부분 일치 허용)
            matched_key = next((k for k in flat if our_candidate_name in k or k in our_candidate_name), None)
            if matched_key:
                has_ours = True
                our_value = flat[matched_key]
                sorted_vals = sorted(flat.items(), key=lambda x: -x[1])
                our_rank = next((i + 1 for i, (k, _) in enumerate(sorted_vals) if k == matched_key), None)

        if has_ours and s.election_type == our_type:
            grp["is_our_election"] = True

        grp["questions"].append({
            "id": str(s.id),
            "election_type": s.election_type,
            "question_text": f"{s.election_type or '지지율'} 질문",
            "results": flat,
            "raw_results": s.results,  # 중첩 JSON 원본 유지 (UI에서 필요시)
            "has_our_candidate": has_ours,
            "our_rank": our_rank,
            "our_value": our_value,
            "is_our_election_type": s.election_type == our_type,
        })

    # 각 그룹 내 question 정렬: 우리 선거 먼저, 그 다음 election_type 순
    result_groups = []
    for key, grp in groups.items():
        grp["questions"].sort(key=lambda q: (
            0 if q["is_our_election_type"] else 1,
            q.get("election_type") or "zz",
        ))
        result_groups.append(grp)

    # 그룹 정렬: 날짜 역순, 우리 선거 포함 먼저
    result_groups.sort(key=lambda g: (
        0 if g["is_our_election"] else 1,
        -(int((g["survey_date"] or "0000-00-00").replace("-", "")) if g["survey_date"] else 0),
    ))

    return {
        "our_election_type": our_type,
        "our_candidates": our_names,
        "our_candidate_name": our_candidate_name,
        "groups": result_groups,
        "total_groups": len(result_groups),
        "total_questions": sum(len(g["questions"]) for g in result_groups),
    }


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
