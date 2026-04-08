"""
ElectionPulse - 과거 선거 심층 분석 엔진
6가지 분석 + AI 전략 리포트 생성
"""
from collections import defaultdict
from datetime import date

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.elections.models import Election, Candidate
from app.elections.history_models import (
    ElectionResult, EarlyVoting, VoterTurnout,
    PoliticalContext, RegionalDemographic, AnalysisCache,
)

logger = structlog.get_logger()


async def analyze_history_deep(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
) -> dict:
    """
    과거 선거 심층 분석 — 6가지 차원.
    1. 역대 당선자 패턴
    2. 구시군별 득표율 비교
    3. 투표율 분석 (전체/사전/연령대)
    4. 정치 환경 상관관계
    5. 스윙 지역 식별
    6. AI 전략 분석
    """
    # tenant_id를 UUID로 변환
    from uuid import UUID as PyUUID
    try:
        tid_uuid = PyUUID(tenant_id) if isinstance(tenant_id, str) else tenant_id
    except ValueError:
        tid_uuid = tenant_id

    # 선거 정보
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"error": "선거 정보 없음"}

    region = election.region_sido
    etype = election.election_type
    tenant_id = tid_uuid

    # 캐시 체크 — election_type을 키에 포함 (시장/교육감 데이터 섞이지 않도록)
    cache_key = f"history_deep_{etype}_{region}"
    cache = (await db.execute(
        select(AnalysisCache).where(
            AnalysisCache.tenant_id == tenant_id,
            AnalysisCache.analysis_type == cache_key,
            AnalysisCache.analysis_date == date.today(),
        )
    )).scalar_one_or_none()

    if cache and cache.result_data:
        # 캐시도 검증: 응답에 다른 election_type 데이터가 있으면 무효화
        cached_etype = cache.result_data.get("election_type")
        if cached_etype == etype:
            return cache.result_data

    # 선거 유형별 매핑 (시장/군수/구청장은 같은 mayor 카테고리로 검색)
    SAME_CATEGORY = {
        "mayor": ["mayor", "gun_head", "gu_head"],
        "gun_head": ["mayor", "gun_head", "gu_head"],
        "gu_head": ["mayor", "gun_head", "gu_head"],
        "metro_council": ["metro_council"],
        "basic_council": ["basic_council"],
        "governor": ["governor"],
        "superintendent": ["superintendent"],
        "congressional": ["congressional"],
    }
    search_types = SAME_CATEGORY.get(etype, [etype])

    # ── 1. 역대 선거 결과 조회 (같은 지역 + 같은 카테고리, 모든 캠프 공유) ──
    results = (await db.execute(
        select(ElectionResult).where(
            ElectionResult.region_sido == region,
            ElectionResult.election_type.in_(search_types),
        ).order_by(ElectionResult.election_year, ElectionResult.vote_rate.desc())
    )).scalars().all()

    # Fallback: 시장/군수/구청장 데이터가 없으면 광역단체장(governor) 데이터로 대체.
    # 같은 지역의 정치 지형(진보/보수 분포, 투표율, 스윙 지역)을 보여주는 데 충분히 의미 있음.
    fallback_used = None
    if not results and etype in ("mayor", "gun_head", "gu_head", "metro_council", "basic_council"):
        results = (await db.execute(
            select(ElectionResult).where(
                ElectionResult.region_sido == region,
                ElectionResult.election_type == "governor",
            ).order_by(ElectionResult.election_year, ElectionResult.vote_rate.desc())
        )).scalars().all()
        if results:
            fallback_used = "governor"
            logger.info("history_fallback_to_governor", region=region, original_type=etype)

    if not results:
        return {
            "error": f"'{region}' 과거 선거 데이터 없음. NEC API에서 자동 수집이 필요합니다.",
            "sections": {},
            "election_type": etype,
            "region": region,
        }

    # 합계(전체)와 구시군별 분리
    total_results = [r for r in results if r.region_sigungu is None]
    district_results = [r for r in results if r.region_sigungu is not None]

    # ── 분석 1: 역대 당선자 패턴 (합계만 사용) ──
    winner_pattern = _analyze_winner_pattern(total_results if total_results else results)

    # ── 분석 2: 구시군별 성향 분석 (같은 카테고리 + 도지사 보강) ──
    all_district = list(district_results)
    try:
        # 광역단체장(도지사) 구시군별 데이터도 함께 (지역 정치성향 보조)
        governor_results = (await db.execute(
            select(ElectionResult).where(
                ElectionResult.region_sido == region,
                ElectionResult.election_type == "governor",
                ElectionResult.region_sigungu.is_not(None),
            )
        )).scalars().all()
        all_district.extend(governor_results)
    except Exception:
        pass
    district_analysis = _analyze_districts(all_district)

    # ── 분석 3: 투표율 (같은 지역, 같은 카테고리 우선 → 없으면 전체) ──
    early_voting_data = (await db.execute(
        select(EarlyVoting).where(
            EarlyVoting.region_sido == region,
            EarlyVoting.election_type.in_(search_types),
        ).order_by(EarlyVoting.election_year)
    )).scalars().all()
    if not early_voting_data:
        # fallback: 같은 지역의 모든 사전투표
        early_voting_data = (await db.execute(
            select(EarlyVoting).where(EarlyVoting.region_sido == region)
            .order_by(EarlyVoting.election_year)
        )).scalars().all()

    turnout_data = (await db.execute(
        select(VoterTurnout).where(
            VoterTurnout.region_sido == region,
        ).order_by(VoterTurnout.election_year)
    )).scalars().all()

    turnout_analysis = _analyze_turnout(early_voting_data, turnout_data)

    # ── 분석 4: 정치 환경 (공유 데이터) ──
    political_data = (await db.execute(
        select(PoliticalContext).order_by(PoliticalContext.data_date.desc())
    )).scalars().all()

    political_analysis = _analyze_political_context(political_data, winner_pattern)

    # ── 분석 5: 스윙 지역 식별 ──
    swing_analysis = _identify_swing_districts(results)

    # AI 분석은 별도 요청 시에만 (페이지 로딩 속도를 위해)
    ai_analysis = {"text": "", "ai_generated": False, "factsheet": ""}

    analysis_result = {
        "region": region,
        "election_type": etype,
        "fallback_used": fallback_used,  # "governor" 면 광역 데이터로 대체된 것
        "fallback_notice": (
            f"청주 {etype} 단위 과거 선거 데이터가 부족하여 충북 광역단체장(도지사) 데이터로 정치 지형을 분석합니다. 진보/보수 분포·투표율·스윙 지역은 시장 선거에도 그대로 적용됩니다."
            if fallback_used == "governor" else None
        ),
        "elections_count": len(set(r.election_year for r in results)),
        "sections": {
            "winner_pattern": winner_pattern,
            "district_analysis": district_analysis,
            "turnout_analysis": turnout_analysis,
            "political_context": political_analysis,
            "swing_districts": swing_analysis,
            "ai_strategy": ai_analysis,
        },
    }

    # 캐시 저장 (election_type을 키에 포함)
    try:
        db.add(AnalysisCache(
            tenant_id=tenant_id,
            analysis_type=cache_key,
            analysis_date=date.today(),
            period_days=0,
            result_data=analysis_result,
        ))
        await db.flush()
    except Exception:
        pass  # 캐시 실패는 무시

    return analysis_result


def _analyze_winner_pattern(results: list) -> dict:
    """분석 1: 역대 당선자 패턴 — 진보/보수 교대, 연속 당선 등."""
    by_year = defaultdict(list)
    for r in results:
        by_year[r.election_year].append(r)

    elections = []
    for year in sorted(by_year.keys()):
        candidates = sorted(by_year[year], key=lambda x: -(x.vote_rate or 0))
        winner = next((c for c in candidates if c.is_winner), candidates[0] if candidates else None)

        elections.append({
            "year": year,
            "election_number": candidates[0].election_number if candidates else None,
            "winner": {
                "name": winner.candidate_name if winner else "불명",
                "party": winner.party if winner else "",
                "vote_rate": winner.vote_rate if winner else 0,
            },
            "runner_up": {
                "name": candidates[1].candidate_name if len(candidates) > 1 else "",
                "party": candidates[1].party if len(candidates) > 1 else "",
                "vote_rate": candidates[1].vote_rate if len(candidates) > 1 else 0,
            } if len(candidates) > 1 else None,
            "candidates_count": len(candidates),
            "top3": [
                {"name": c.candidate_name, "party": c.party, "vote_rate": c.vote_rate, "is_winner": c.is_winner}
                for c in candidates[:3]
            ],
            "margin": round((candidates[0].vote_rate or 0) - (candidates[1].vote_rate or 0), 1) if len(candidates) > 1 else 0,
        })

    # 패턴 분석
    parties = [e["winner"]["party"] for e in elections if e["winner"]["party"]]
    alternation_count = sum(1 for i in range(1, len(parties)) if parties[i] != parties[i-1])

    return {
        "elections": elections,
        "total_elections": len(elections),
        "alternation_rate": round(alternation_count / max(len(parties) - 1, 1) * 100),
        "dominant_party": max(set(parties), key=parties.count) if parties else "불명",
        "pattern_summary": _summarize_pattern(parties),
    }


def _summarize_pattern(parties: list) -> str:
    """정당 교대 패턴 요약."""
    if not parties:
        return "데이터 없음"
    if len(set(parties)) == 1:
        return f"{parties[0]} 독주 (전 선거 동일 정당 당선)"

    consecutive = 1
    max_consecutive = 1
    for i in range(1, len(parties)):
        if parties[i] == parties[i-1]:
            consecutive += 1
            max_consecutive = max(max_consecutive, consecutive)
        else:
            consecutive = 1

    if max_consecutive >= 3:
        return f"장기 집권 패턴 (최대 {max_consecutive}연속 같은 정당)"
    else:
        return "교대 패턴 (정당이 자주 교체됨)"


def _analyze_districts(results: list) -> dict:
    """분석 2: 구시군별 성향 분석 — 교육감+도지사 합산, 강세/공략필요 2분류."""
    by_district = defaultdict(lambda: defaultdict(list))

    for r in results:
        district = r.region_sigungu or "전체"
        by_district[district][r.election_year].append({
            "name": r.candidate_name,
            "party": r.party,  # 진보 or 보수
            "vote_rate": r.vote_rate or 0,
            "is_winner": r.is_winner,
        })

    district_summary = []
    for district, years in by_district.items():
        if district == "전체":
            continue

        # 각 선거에서 진보/보수 1위 성향 추출
        progressive_wins = 0
        conservative_wins = 0
        total_elections = 0
        progressive_avg = []
        conservative_avg = []

        for year in sorted(years.keys()):
            candidates = sorted(years[year], key=lambda x: -x["vote_rate"])
            if not candidates:
                continue
            total_elections += 1
            winner_party = candidates[0]["party"]
            if winner_party == "진보":
                progressive_wins += 1
            elif winner_party == "보수":
                conservative_wins += 1

            # 진보/보수 합산 득표율
            prog_total = sum(c["vote_rate"] for c in candidates if c["party"] == "진보")
            cons_total = sum(c["vote_rate"] for c in candidates if c["party"] == "보수")
            if prog_total > 0:
                progressive_avg.append(prog_total)
            if cons_total > 0:
                conservative_avg.append(cons_total)

        # 최근 선거 결과
        latest_year = max(years.keys())
        latest = sorted(years[latest_year], key=lambda x: -x["vote_rate"])

        # 성향 계산 (진보 득표율 평균)
        avg_prog = round(sum(progressive_avg) / len(progressive_avg), 1) if progressive_avg else 0
        avg_cons = round(sum(conservative_avg) / len(conservative_avg), 1) if conservative_avg else 0
        dominant = "진보" if avg_prog > avg_cons else "보수"
        dominant_rate = max(avg_prog, avg_cons)

        district_summary.append({
            "district": district,
            "latest_year": latest_year,
            "latest_results": latest[:3],
            "dominant": dominant,
            "progressive_rate": avg_prog,
            "conservative_rate": avg_cons,
            "dominant_rate": dominant_rate,
            "progressive_wins": progressive_wins,
            "conservative_wins": conservative_wins,
            "total_elections": total_elections,
            # 강세율: 우세 성향의 승률 (65%+ = 강세)
            "strength_rate": round(max(progressive_wins, conservative_wins) / max(total_elections, 1) * 100),
        })

    # 강세 지역 vs 공략 필요 지역 (65% 기준)
    district_summary.sort(key=lambda x: -x["strength_rate"])
    # 강세: 진보/보수 득표율 차이가 8%p 이상인 지역
    # 공략필요: 그 외 (접전 + 약세)
    for d in district_summary:
        d["gap"] = round(abs(d["progressive_rate"] - d["conservative_rate"]), 1)
    strong = [d for d in district_summary if d["gap"] >= 8]
    targets = [d for d in district_summary if d["gap"] < 8]
    strong.sort(key=lambda x: -x["gap"])
    targets.sort(key=lambda x: x["gap"])

    return {
        "districts": district_summary,
        "total_districts": len(district_summary),
        "strong_districts": strong,
        "target_districts": targets,
    }


def _analyze_turnout(early_data: list, turnout_data: list) -> dict:
    """분석 3: 투표율 분석."""
    # 사전투표 추이
    early_trend = []
    for ev in early_data:
        early_trend.append({
            "year": ev.election_year,
            "election_number": ev.election_number,
            "early_rate": ev.early_rate,
            "election_day_rate": ev.election_day_rate,
            "total_rate": ev.total_rate,
            "district": ev.region_sigungu or "전체",
        })

    # 연령대별 투표율
    age_turnout = defaultdict(list)
    for t in turnout_data:
        if t.category == "age" or t.category == "연령대":
            age_turnout[t.segment].append({
                "year": t.election_year,
                "turnout_rate": t.turnout_rate,
                "eligible": t.eligible_voters,
                "actual": t.actual_voters,
            })

    # 전체 투표율 추이
    total_trend = []
    seen_years = set()
    for ev in early_data:
        if ev.region_sigungu is None and ev.election_year not in seen_years:
            total_trend.append({
                "year": ev.election_year,
                "total_rate": ev.total_rate,
                "early_rate": ev.early_rate,
            })
            seen_years.add(ev.election_year)

    return {
        "total_trend": sorted(total_trend, key=lambda x: x["year"]),
        "early_voting_trend": early_trend,
        "age_turnout": dict(age_turnout),
        "insight": _turnout_insight(total_trend, age_turnout),
    }


def _turnout_insight(total_trend: list, age_turnout: dict) -> str:
    """투표율 인사이트 자동 생성."""
    if not total_trend:
        return "투표율 데이터가 아직 없습니다."

    sorted_trend = sorted(total_trend, key=lambda x: x["year"])
    if len(sorted_trend) >= 2:
        latest = sorted_trend[-1]
        prev = sorted_trend[-2]
        diff = (latest.get("total_rate") or 0) - (prev.get("total_rate") or 0)
        direction = "상승" if diff > 0 else "하락"
        return f"최근 투표율 {latest.get('total_rate', 0):.1f}% ({direction} {abs(diff):.1f}%p)"
    return f"투표율 {sorted_trend[-1].get('total_rate', 0):.1f}%"


def _analyze_political_context(political_data: list, winner_pattern: dict) -> dict:
    """분석 4: 정치 환경 상관관계."""
    if not political_data:
        return {
            "current": None,
            "historical": [],
            "correlation_note": "정치 환경 데이터가 아직 없습니다.",
        }

    latest = political_data[0] if political_data else None

    return {
        "current": {
            "date": latest.data_date.isoformat() if latest else None,
            "president_approval": latest.president_approval if latest else None,
            "ruling_party": latest.ruling_party_support if latest else None,
            "opposition_party": latest.opposition_party_support if latest else None,
            "source": latest.source if latest else None,
        } if latest else None,
        "historical": [
            {
                "date": p.data_date.isoformat(),
                "president": p.president_approval,
                "ruling": p.ruling_party_support,
                "opposition": p.opposition_party_support,
            }
            for p in political_data[:10]
        ],
        "correlation_note": _political_correlation(political_data, winner_pattern),
    }


def _political_correlation(political_data: list, winner_pattern: dict) -> str:
    """정치 환경과 선거 결과 상관관계 요약."""
    if not political_data:
        return "데이터 부족"

    latest = political_data[0]
    ruling = latest.ruling_party_support or 0
    opposition = latest.opposition_party_support or 0

    if ruling > opposition:
        return f"현재 여당 우세 ({ruling:.1f}% vs {opposition:.1f}%) — 여당 성향 후보에게 유리한 환경"
    elif opposition > ruling:
        return f"현재 야당 우세 ({opposition:.1f}% vs {ruling:.1f}%) — 야당 성향 후보에게 유리한 환경"
    return f"여야 팽팽 ({ruling:.1f}% vs {opposition:.1f}%) — 후보 개인 역량이 관건"


def _identify_swing_districts(results: list) -> dict:
    """분석 5: 스윙 지역 식별 — 매 선거마다 승자가 바뀌는 접전 지역."""
    by_district = defaultdict(lambda: defaultdict(list))

    for r in results:
        district = r.region_sigungu or "전체"
        by_district[district][r.election_year].append(r)

    swing_districts = []
    stable_districts = []

    for district, years in by_district.items():
        if district == "전체" or len(years) < 2:
            continue

        # 각 선거 1위 정당
        winners = []
        margins = []
        for year in sorted(years.keys()):
            candidates = sorted(years[year], key=lambda x: -(x.vote_rate or 0))
            if candidates:
                winners.append(candidates[0].party)
                if len(candidates) > 1:
                    margins.append((candidates[0].vote_rate or 0) - (candidates[1].vote_rate or 0))

        # 1위 정당이 바뀐 횟수
        changes = sum(1 for i in range(1, len(winners)) if winners[i] != winners[i-1])
        avg_margin = sum(margins) / len(margins) if margins else 0

        info = {
            "district": district,
            "changes": changes,
            "total_elections": len(years),
            "change_rate": round(changes / max(len(winners) - 1, 1) * 100),
            "avg_margin": round(avg_margin, 1),
            "latest_winner_party": winners[-1] if winners else "",
        }

        if changes >= 2 or avg_margin < 10:
            swing_districts.append(info)
        else:
            stable_districts.append(info)

    swing_districts.sort(key=lambda x: -x["change_rate"])

    return {
        "swing": swing_districts,
        "stable": stable_districts,
        "total_swing": len(swing_districts),
        "total_stable": len(stable_districts),
        "strategy_note": f"스윙 지역 {len(swing_districts)}곳 — 집중 공략 필요" if swing_districts else "안정적 지역 구도",
    }


async def _generate_ai_analysis(
    db: AsyncSession,
    election: Election,
    winner_pattern: dict,
    district_analysis: dict,
    turnout_analysis: dict,
    political_analysis: dict,
    swing_analysis: dict,
) -> dict:
    """분석 6: Claude AI 심층 전략 분석."""
    import subprocess
    import json

    # 우리 후보 정보
    our = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election.id,
            Candidate.is_our_candidate == True,
        )
    )).scalar_one_or_none()

    # AI에게 보낼 팩트시트
    factsheet = f"""
## 과거 선거 심층 분석 팩트시트

### 선거 정보
- 선거: {election.name}
- 지역: {election.region_sido}
- 유형: {election.election_type}
- 우리 후보: {our.name if our else '미설정'} ({our.party if our else ''})

### 역대 당선자 ({winner_pattern['total_elections']}회)
{chr(10).join(f"- {e['year']}년: {e['winner']['name']} ({e['winner']['party']}) {e['winner']['vote_rate']}% / 2위 {e.get('runner_up',{}).get('name','없음')} {e.get('runner_up',{}).get('vote_rate',0)}%" for e in winner_pattern['elections'])}
- 패턴: {winner_pattern['pattern_summary']}
- 교대��: {winner_pattern['alternation_rate']}%

### 구시군별 분석
- 철옹성 지역: {', '.join(d['district'] for d in district_analysis.get('strongholds', [])[:5])}
- 접전 지역: {', '.join(d['district'] for d in district_analysis.get('battlegrounds', [])[:5])}

### 투표율
- {turnout_analysis.get('insight', '데이터 없음')}

### 정치 환경
- {political_analysis.get('correlation_note', '데이터 없음')}

### 스윙 지역
- {swing_analysis.get('strategy_note', '데이터 없음')}
"""

    prompt = f"""당신은 선거 전략 분석 전문가입니다. 아래 데이터를 바탕으로 우리 후보({our.name if our else '미설정'})의 과거 선거 기반 전략을 분석하세요.

{factsheet}

다음 형식으로 한국어 분석을 작성하세요 (1500자 이내):

1. 역대 패턴에서 읽는 2026 전략
2. 우리에게 유리한 지역 / 불리한 지역
3. 투표율과 당선의 상관관계
4. 현 정치 환경이 우리에게 미치는 영향
5. 핵심 공략 지역 TOP 3과 이유
6. 불편한 진실 (우리에게 불리한 데이터)

객관적이고 솔직하게 — 유리한 점과 불리한 점을 모두 포함하세요."""

    ai_text = ""
    ai_generated = False

    try:
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True, text=True, timeout=90,
        )
        if result.returncode == 0 and result.stdout.strip():
            ai_text = result.stdout.strip()
            ai_generated = True
    except Exception as e:
        logger.warning("history_ai_failed", error=str(e))

    if not ai_text:
        ai_text = f"AI 분석을 생성하지 못했습니다. 위 데이터를 참고하여 전략을 수립하세요.\n\n{factsheet}"

    return {
        "text": ai_text,
        "ai_generated": ai_generated,
        "factsheet": factsheet,
    }
