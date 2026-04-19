"""
ElectionPulse - 여론조사 심층 분석 엔진
교차분석 + 강약 세그먼트 + 추이 + 부동층 + 시나리오 + AI 전략
"""
from collections import defaultdict
from datetime import date
import math

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.elections.models import (
    Election, Candidate, Survey, SurveyCrosstab, SurveyQuestion,
)

logger = structlog.get_logger()


async def analyze_survey_deep(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
) -> dict:
    """
    여론조사 심층 분석 — 6가지 차원.
    1. 교차분석 테이블
    2. 강점/약점 세그먼트
    3. 추이 분석
    4. 부동층 분석
    5. 조건부/시나리오 분석
    6. AI 전략 분석
    """
    # UUID 변환
    from uuid import UUID as PyUUID
    try:
        tenant_id = PyUUID(tenant_id) if isinstance(tenant_id, str) else tenant_id
    except (ValueError, AttributeError):
        pass

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"error": "선거 정보 없음"}

    # 우리 후보 (election-shared: tenant_elections 기준)
    from app.common.election_access import get_our_candidate_id
    _my_id = await get_our_candidate_id(db, tenant_id, election.id)
    our = None
    if _my_id:
        our = (await db.execute(
            select(Candidate).where(Candidate.id == _my_id)
        )).scalar_one_or_none()

    # 여론조사 데이터 조회 — 같은 선거(election_type + region_sido + region_sigungu)와
    # 정확히 매칭되는 조사만. 섞임 방지 (2026-04-19 교육감에 도지사/시장 조사가 섞여
    # "김재종·김승룡" 같은 엉뚱한 후보로 AI 분석된 버그 수정)
    from sqlalchemy import and_
    conditions = [
        Survey.election_type == election.election_type,
        Survey.region_sido == election.region_sido,
    ]
    if election.region_sigungu:
        conditions.append(Survey.region_sigungu == election.region_sigungu)
    else:
        # 시도급 선거(교육감/도지사): 시군구 없는 조사만 매칭
        conditions.append(Survey.region_sigungu.is_(None))
    logger.info("survey_query_debug",
                etype=election.election_type,
                sido=election.region_sido,
                sigungu=election.region_sigungu)
    all_matched = (await db.execute(
        select(Survey).where(and_(*conditions))
        .order_by(Survey.survey_date.desc())
    )).scalars().all()

    # 우리 후보가 실제로 등장하는 조사만 (추이/교차 분석 대상)
    our_name = our.name if our else None
    if our_name:
        surveys = [
            s for s in all_matched
            if isinstance(s.results, dict) and our_name in s.results
        ]
    else:
        surveys = list(all_matched)
    logger.info("survey_query_result",
                matched_election=len(all_matched),
                with_our_candidate=len(surveys),
                our_name=our_name)

    if not surveys:
        return {
            "error": (
                f"'{our_name}' 후보가 포함된 여론조사가 없습니다. "
                f"같은 선거 조사 {len(all_matched)}건 중 0건."
                if our_name else
                f"해당 선거(election_type={election.election_type}, {election.region_sido})에 등록된 여론조사 없음."
            ),
            "sections": {},
            "total_surveys": 0,
            "matched_election": len(all_matched),
        }

    # 교차분석 데이터
    survey_ids = [s.id for s in surveys]
    crosstabs = (await db.execute(
        select(SurveyCrosstab).where(
            SurveyCrosstab.survey_id.in_(survey_ids)
        )
    )).scalars().all()

    # 질문지 데이터
    questions = (await db.execute(
        select(SurveyQuestion).where(
            SurveyQuestion.survey_id.in_(survey_ids)
        ).order_by(SurveyQuestion.question_number)
    )).scalars().all()

    # our_name은 위에서 이미 정의됨

    # ── 분석 1: 교차분석 테이블 ──
    crosstab_analysis = _analyze_crosstabs(crosstabs, our_name)

    # ── 분석 2: 강점/약점 세그먼트 ──
    strength_weakness = _find_strength_weakness(crosstabs, our_name)

    # ── 분석 3: 추이 분석 ──
    trend_analysis = _analyze_trend(surveys, our_name)

    # ── 분석 4: 부동층 분석 ──
    undecided_analysis = _analyze_undecided(surveys)

    # ── 분석 5: 조건부/시나리오 분석 ──
    scenario_analysis = _analyze_scenarios(questions, our_name)

    # ── 분석 6: 신뢰구간 계산 ──
    confidence_analysis = _calculate_confidence(surveys, our_name)

    # ── AI 전략 ──
    try:
        ai_analysis = await _generate_survey_ai(
            db, election, our, surveys, crosstab_analysis,
            strength_weakness, trend_analysis, undecided_analysis,
            tenant_id=str(tenant_id),
        )
    except Exception as e:
        import traceback as _tb
        logger.warning("survey_ai_generation_failed", error=str(e), tb=_tb.format_exc()[:800])
        ai_analysis = {"text": f"AI 분석 생성 실패: {str(e)[:120]}", "ai_generated": False}

    return {
        "total_surveys": len(surveys),
        "latest_date": surveys[0].survey_date.isoformat() if surveys and surveys[0].survey_date else None,
        "our_candidate": our_name,
        "sections": {
            "crosstab": crosstab_analysis,
            "strength_weakness": strength_weakness,
            "trend": trend_analysis,
            "undecided": undecided_analysis,
            "scenarios": scenario_analysis,
            "confidence": confidence_analysis,
            "ai_strategy": ai_analysis,
        },
    }


def _analyze_crosstabs(crosstabs: list, our_name: str | None) -> dict:
    """분석 1: 교차분석 테이블 — 차원별 후보 지지율."""
    if not crosstabs:
        return {"dimensions": {}, "has_data": False}

    # 차원별 그룹핑
    dims = defaultdict(lambda: defaultdict(dict))
    for ct in crosstabs:
        dims[ct.dimension][ct.segment][ct.candidate] = ct.value

    result = {}
    for dim, segments in dims.items():
        seg_list = []
        for seg, candidates in segments.items():
            seg_data = {"segment": seg, "candidates": candidates}
            if our_name and our_name in candidates:
                seg_data["our_value"] = candidates[our_name]
            seg_list.append(seg_data)
        # 우리 후보 지지율 높은 순 정렬
        if our_name:
            seg_list.sort(key=lambda x: -(x.get("our_value", 0) or 0))
        result[dim] = seg_list

    dim_labels = {
        "age": "연령대", "gender": "성별", "region": "지역",
        "ideology": "이념성향", "party": "지지정당",
        "issue": "핵심과제", "education": "학력",
        "연령대": "연령대", "성별": "성별", "지역": "지역",
        "이념성향": "이념성향", "지지정당": "지지정당",
    }

    return {
        "dimensions": result,
        "dimension_labels": {k: dim_labels.get(k, k) for k in result.keys()},
        "has_data": len(result) > 0,
    }


def _find_strength_weakness(crosstabs: list, our_name: str | None) -> dict:
    """분석 2: 우리 후보 강점/약점 세그먼트 식별."""
    if not our_name or not crosstabs:
        return {"strengths": [], "weaknesses": [], "parity": []}

    # 세그먼트별 우리 후보 vs 최고 경쟁자
    segments = defaultdict(lambda: defaultdict(float))
    for ct in crosstabs:
        key = f"{ct.dimension}:{ct.segment}"
        segments[key][ct.candidate] = ct.value

    strengths = []
    weaknesses = []
    parity = []

    for key, candidates in segments.items():
        dim, seg = key.split(":", 1)
        our_val = candidates.get(our_name, 0)
        others = {k: v for k, v in candidates.items() if k != our_name}
        if not others:
            continue
        best_rival_name = max(others, key=others.get)
        best_rival_val = others[best_rival_name]
        gap = our_val - best_rival_val

        info = {
            "dimension": dim,
            "segment": seg,
            "our_rate": round(our_val, 1),
            "rival_name": best_rival_name,
            "rival_rate": round(best_rival_val, 1),
            "gap": round(gap, 1),
        }

        if gap > 3:
            strengths.append(info)
        elif gap < -3:
            weaknesses.append(info)
        else:
            parity.append(info)

    strengths.sort(key=lambda x: -x["gap"])
    weaknesses.sort(key=lambda x: x["gap"])

    return {
        "strengths": strengths[:10],
        "weaknesses": weaknesses[:10],
        "parity": parity[:5],
    }


def _analyze_trend(surveys: list, our_name: str | None) -> dict:
    """분석 3: 여론조사 추이 분석."""
    trend_data = []
    for s in reversed(surveys):  # 오래된 것부터
        if not s.results or not isinstance(s.results, dict):
            continue
        entry = {
            "date": s.survey_date.isoformat() if s.survey_date else None,
            "org": s.survey_org,
            "sample_size": s.sample_size,
            "candidates": s.results,
        }
        if our_name and our_name in s.results:
            entry["our_rate"] = s.results[our_name]
        trend_data.append(entry)

    # 추세 계산 (최근 3개 vs 이전 3개)
    momentum = None
    if our_name and len(trend_data) >= 4:
        recent = [t["our_rate"] for t in trend_data[-3:] if "our_rate" in t]
        earlier = [t["our_rate"] for t in trend_data[-6:-3] if "our_rate" in t]
        if recent and earlier:
            recent_avg = sum(recent) / len(recent)
            earlier_avg = sum(earlier) / len(earlier)
            diff = recent_avg - earlier_avg
            momentum = {
                "direction": "상승" if diff > 1 else "하락" if diff < -1 else "보합",
                "change": round(diff, 1),
                "recent_avg": round(recent_avg, 1),
                "earlier_avg": round(earlier_avg, 1),
            }

    return {
        "data": trend_data,
        "total_surveys": len(trend_data),
        "momentum": momentum,
    }


def _analyze_undecided(surveys: list) -> dict:
    """분석 4: 부동층(모름/무응답) 분석."""
    undecided_data = []
    for s in surveys:
        if not s.results or not isinstance(s.results, dict):
            continue
        total = sum(v for v in s.results.values() if isinstance(v, (int, float)))
        undecided = max(0, 100 - total)
        if undecided > 0.5:
            undecided_data.append({
                "date": s.survey_date.isoformat() if s.survey_date else None,
                "org": s.survey_org,
                "undecided_rate": round(undecided, 1),
                "total_decided": round(total, 1),
            })

    avg_undecided = sum(u["undecided_rate"] for u in undecided_data) / len(undecided_data) if undecided_data else 0

    return {
        "data": undecided_data[:10],
        "avg_undecided": round(avg_undecided, 1),
        "insight": _undecided_insight(avg_undecided),
    }


def _undecided_insight(avg: float) -> str:
    if avg > 20:
        return f"부동층 {avg:.1f}% — 매우 높음. 선거판이 아직 유동적이며, 이 층의 포섭이 당락을 결정합니다."
    elif avg > 10:
        return f"부동층 {avg:.1f}% — 상당함. 후보 인지도 제고와 차별화 메시지가 핵심입니다."
    elif avg > 5:
        return f"부동층 {avg:.1f}% — 보통. 지지층 결집과 동시에 부동층 설득이 필요합니다."
    return f"부동층 {avg:.1f}% — 낮음. 선거판이 굳어지고 있어 기존 지지층 이탈 방지가 중요합니다."


def _analyze_scenarios(questions: list, our_name: str | None) -> dict:
    """분석 5: 조건부/시나리오 분석 — 단일화, 이슈별 등."""
    scenarios = defaultdict(list)
    for q in questions:
        if q.question_type in ("conditional", "issue_based", "matchup"):
            results = q.results if isinstance(q.results, dict) else {}
            scenarios[q.question_type].append({
                "question": q.question_text,
                "condition": q.condition_text,
                "results": results,
                "our_rate": results.get(our_name, 0) if our_name else None,
            })

    return {
        "conditional": scenarios.get("conditional", []),
        "issue_based": scenarios.get("issue_based", []),
        "matchup": scenarios.get("matchup", []),
        "has_scenarios": len(scenarios) > 0,
    }


def _calculate_confidence(surveys: list, our_name: str | None) -> dict:
    """분석 6: 신뢰구간 계산."""
    if not surveys or not our_name:
        return {"intervals": []}

    intervals = []
    for s in surveys[:5]:
        if not s.results or not isinstance(s.results, dict):
            continue
        our_rate = s.results.get(our_name, 0)
        moe = s.margin_of_error or 3.0  # 기본 오차 3%
        confidence = s.confidence_level or 95.0

        intervals.append({
            "date": s.survey_date.isoformat() if s.survey_date else None,
            "org": s.survey_org,
            "rate": round(our_rate, 1),
            "moe": round(moe, 1),
            "lower": round(our_rate - moe, 1),
            "upper": round(our_rate + moe, 1),
            "confidence": confidence,
            "sample_size": s.sample_size,
        })

    return {"intervals": intervals}


async def _generate_survey_ai(
    db, election, our, surveys, crosstab_analysis,
    strength_weakness, trend_analysis, undecided_analysis,
    tenant_id: str | None = None,
) -> dict:
    """AI 여론조사 전략 분석 — call_claude_text 경유 (premium tier)."""
    from app.services.ai_service import call_claude_text

    our_name = our.name if our else "미설정"

    # 최근 여론조사: 우리 후보가 포함된 조사 중 최신 (상위 호출자가 이미 필터)
    latest = surveys[0] if surveys else None
    raw_results = latest.results if latest and isinstance(latest.results, dict) else {}
    latest_results = {}
    for k, v in raw_results.items():
        if isinstance(v, (int, float)):
            latest_results[k] = v
        elif isinstance(v, dict):
            for sk, sv in v.items():
                if isinstance(sv, (int, float)):
                    latest_results[sk] = sv

    # 우리 후보 순위 / 격차 (사실 기반)
    ranked = sorted(
        [(n, v) for n, v in latest_results.items() if isinstance(v, (int, float))],
        key=lambda x: -x[1]
    )
    our_val = next((v for n, v in ranked if n == our_name), None)
    our_rank = next((i + 1 for i, (n, _) in enumerate(ranked) if n == our_name), None)
    top_name, top_val = ranked[0] if ranked else (None, None)
    gap_to_top = (our_val - top_val) if (our_val is not None and top_val is not None) else None

    # 강약 세그먼트 요약
    strengths = (strength_weakness or {}).get("strengths", [])[:5]
    weaknesses = (strength_weakness or {}).get("weaknesses", [])[:5]

    # 모든 조사 요약 (AI가 추세를 직접 읽도록)
    all_surveys_lines = []
    for s in surveys[:10]:  # 최신 10건
        r = s.results if isinstance(s.results, dict) else {}
        nums = {k: v for k, v in r.items() if isinstance(v, (int, float))}
        rv = nums.get(our_name)
        top = sorted(nums.items(), key=lambda x: -x[1])[:3]
        top_str = ", ".join(f"{n} {v}%" for n, v in top)
        all_surveys_lines.append(
            f"- {s.survey_date} ({s.survey_org}, n={s.sample_size or '?'}): "
            f"{our_name} {rv if rv is not None else 'N/A'}% | Top3: {top_str}"
        )

    factsheet = f"""
## 여론조사 심층 분석 팩트시트

### 선거: {election.name} ({election.election_type} · {election.region_sido}{' · '+election.region_sigungu if election.region_sigungu else ''})
### 우리 후보: {our_name}
### 분석 대상 조사: {len(surveys)}건 (우리 후보 포함된 조사만)

### 최근 여론조사 ({latest.survey_org if latest else '없음'}, {latest.survey_date if latest else ''}, n={latest.sample_size if latest else '?'})
{chr(10).join(f'- {k}: {v}%' for k, v in ranked)}
→ 우리 후보 순위: {our_rank if our_rank else 'N/A'}위 / {len(ranked)}명, 1위({top_name}) 대비 {gap_to_top:+.1f}%p

### 조사별 추이 (최신 → 과거)
{chr(10).join(all_surveys_lines) if all_surveys_lines else '- 데이터 없음'}

### 강점 세그먼트 (우리가 +3%p 이상 우세)
{chr(10).join(f'- [{s["dimension"]}] {s["segment"]}: {our_name} {s["our_rate"]}% vs {s["rival_name"]} {s["rival_rate"]}% (+{s["gap"]}%p)' for s in strengths) if strengths else '- 해당 없음'}

### 약점 세그먼트 (우리가 -3%p 이상 열세)
{chr(10).join(f'- [{s["dimension"]}] {s["segment"]}: {our_name} {s["our_rate"]}% vs {s["rival_name"]} {s["rival_rate"]}% ({s["gap"]}%p)' for s in weaknesses) if weaknesses else '- 해당 없음'}

### 추세 분석: {(trend_analysis.get('momentum') or {}).get('direction', '데이터 부족 — 조사 4건 미만')} {f"({(trend_analysis.get('momentum') or {}).get('change', 0):+.1f}%p)" if (trend_analysis.get('momentum') or {}).get('direction') else ''}
### 부동층 평균: {(undecided_analysis or {}).get('avg_undecided', 0):.1f}%
"""

    prompt = f"""당신은 한국 선거 여론조사 분석 전문가입니다. 아래는 **{election.name}** ({election.region_sido}) 선거의 {our_name} 후보 관련 실제 여론조사 데이터입니다.

{factsheet}

**중요 지침**:
- 위 팩트시트에 등장하지 않는 후보 이름·수치·경쟁자·날짜를 절대 추측해서 쓰지 말 것
- 위 데이터만 근거로 분석. 다른 선거(도지사/시장/국회의원) 조사가 아님을 인지
- 조사가 적으면 적다고 정직하게 말할 것
- "데이터 부족"이어도 보이는 데이터로 할 수 있는 분석은 할 것

다음 6개 항목으로 한국어 분석 (1500자 이내, 각 항목은 2~4문장):
1. **현재 지지율 진단** — 위 '최근 여론조사' 기준 순위·격차·추세
2. **강점 세그먼트 확대 전략** — 위 강점 데이터 기반
3. **약점 세그먼트 만회 전략** — 위 약점 데이터 기반
4. **부동층 대응 전략** — {(undecided_analysis or {}).get('avg_undecided', 0):.1f}% 기준
5. **핵심 타겟 3개와 구체적 메시지**
6. **불편한 진실** — 불리한 데이터를 솔직하게

객관적이고 구체적으로. 수치는 반드시 위 팩트시트에서 인용."""

    ai_text = ""
    ai_generated = False

    try:
        text = await call_claude_text(
            prompt, timeout=120,
            context="survey_ai_strategy",  # premium (Opus) — 심층 전략
            tenant_id=tenant_id, db=db,
        )
        if text:
            ai_text = text
            ai_generated = True
    except Exception as e:
        logger.warning("survey_ai_failed", error=str(e))

    if not ai_text:
        ai_text = f"AI 분석을 생성하지 못했습니다.\n\n{factsheet}"

    return {"text": ai_text, "ai_generated": ai_generated}
