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
    HistoricalCandidateCamp,
)
from app.elections.camps import (
    normalize_party as _normalize_party,
    load_camp_overrides,
    load_current_candidate_alignments,
    lookup_camp,
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
    # v3: layout 분기 + 진영 매핑 + 투표율 보강
    cache_key = f"history_deep_v3_{etype}_{region}"
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

    # ── 분석 2: 구시군별 성향 분석 ──
    # 같은 카테고리 데이터만 사용 (mayor+governor 혼합 시 vote_rate 합산이 100% 초과되는 문제 방지)
    district_analysis = _analyze_districts(district_results)

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

    # ── 분석 6: 새 섹션 (v2) ──
    party_trend = _analyze_party_trend(district_results or results)
    strength_grid = _build_strength_grid(district_analysis)
    district_drilldown = _build_district_drilldown(district_results or results)
    turnout_analysis["age_series"] = _series_age_turnout(turnout_analysis.get("age_turnout", {}))

    # ── v3: layout 분기 + 진영 매핑 ──
    # 후보 진영 매핑 로드 (교육감/무소속 후보 분류용)
    camp_overrides = await load_camp_overrides(db, etype, region)
    candidate_alignments = await load_current_candidate_alignments(db, etype)
    layout = _resolve_layout(etype)

    # 시·군·구 사전투표 비교 데이터 (직접 쿼리)
    sigungu_turnout = await _build_sigungu_turnout(db, region)

    # raw 정당 추이 (시장/도지사용)
    raw_party_trend = _analyze_raw_party_trend(district_results or results)

    # 시·군·구 raw 정당 강세 (시장/도지사용)
    raw_party_grid = _build_raw_party_grid(district_results or results)

    # 진영 분포 (교육감용 + 모든 layout에서 사용)
    camp_grid = _build_camp_grid(district_results or results, camp_overrides, candidate_alignments)
    camp_trend = _analyze_camp_trend(district_results or results, camp_overrides, candidate_alignments)
    candidate_strongholds = _build_candidate_strongholds(district_results or results)
    unmapped = _find_unmapped_candidates(district_results or results, camp_overrides, candidate_alignments) if layout == "superintendent" else []

    # AI 분석은 별도 요청 시에만 (페이지 로딩 속도를 위해)
    # 캐시된 structured AI가 있으면 함께 반환
    ai_analysis = await _load_cached_ai_strategy(db, tenant_id, etype, region)

    # ── 한눈에 보기 요약 카드 ──
    summary = _build_summary(
        winner_pattern=winner_pattern,
        district_analysis=district_analysis,
        swing_analysis=swing_analysis,
        turnout_analysis=turnout_analysis,
        ai_analysis=ai_analysis,
    )

    analysis_result = {
        "region": region,
        "election_type": etype,
        "layout": layout,  # v3: mayor|governor|superintendent|council
        "fallback_used": fallback_used,  # "governor" 면 광역 데이터로 대체된 것
        "fallback_notice": (
            f"{region} {etype} 단위 과거 선거 데이터가 부족하여 광역단체장(도지사) 데이터로 정치 지형을 분석합니다. 진보/보수 분포·투표율·스윙 지역은 동일하게 적용됩니다."
            if fallback_used == "governor" else None
        ),
        "elections_count": len(set(r.election_year for r in results)),
        "summary": summary,
        "sections": {
            # v2 sections (호환)
            "winner_pattern": winner_pattern,
            "district_analysis": district_analysis,
            "turnout_analysis": turnout_analysis,
            "political_context": political_analysis,
            "swing_districts": swing_analysis,
            "party_trend": party_trend,
            "strength_grid": strength_grid,
            "district_drilldown": district_drilldown,
            "ai_strategy": ai_analysis,
            # v3 sections
            "raw_party_trend": raw_party_trend,
            "raw_party_grid": raw_party_grid,
            "camp_grid": camp_grid,
            "camp_trend": camp_trend,
            "candidate_strongholds": candidate_strongholds,
            "unmapped_candidates": unmapped,
            "sigungu_turnout": sigungu_turnout,
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

    # 패턴 분석 — 진영(진보/보수) 기준
    camps = [_normalize_party(e["winner"]["party"]) for e in elections if e["winner"]["party"]]
    raw_parties = [e["winner"]["party"] for e in elections if e["winner"]["party"]]
    alternation_count = sum(1 for i in range(1, len(camps)) if camps[i] != camps[i-1])

    return {
        "elections": elections,
        "total_elections": len(elections),
        "alternation_rate": round(alternation_count / max(len(camps) - 1, 1) * 100),
        "dominant_party": max(set(camps), key=camps.count) if camps else "불명",
        "dominant_party_raw": max(set(raw_parties), key=raw_parties.count) if raw_parties else "불명",
        "pattern_summary": _summarize_pattern(camps),
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
    """분석 2: 구시군별 성향 분석 — 교육감+도지사 합산, 강세/대응필요 2분류."""
    by_district = defaultdict(lambda: defaultdict(list))

    for r in results:
        district = r.region_sigungu or "전체"
        by_district[district][r.election_year].append({
            "name": r.candidate_name,
            "party": _normalize_party(r.party),
            "raw_party": r.party,
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

    # 강세 지역 vs 대응 필요 지역 (65% 기준)
    district_summary.sort(key=lambda x: -x["strength_rate"])
    # 강세: 진보/보수 득표율 차이가 8%p 이상인 지역
    # 대응필요: 그 외 (접전 + 약세)
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
                winners.append(_normalize_party(candidates[0].party))
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
        "strategy_note": f"스윙 지역 {len(swing_districts)}곳 — 집중 대응 필요" if swing_districts else "안정적 지역 구도",
    }


def _analyze_party_trend(results: list) -> dict:
    """v2: 회차×정당 평균 득표율 시계열 + 정당별 시군 점유 추이.

    results는 시군별 후보 row 모음. 같은 정당의 후보가 한 시군에 여러 명 있으면 합산.
    """
    by_year_party = defaultdict(lambda: defaultdict(list))   # year -> party -> [vote_rate per district]
    by_year_district_winner = defaultdict(lambda: defaultdict(int))  # year -> party -> #districts won
    by_year_districts = defaultdict(set)  # year -> set of districts (for normalization)

    # 정당별 묶기 (한 시군 안에서 같은 정당의 후보 합산)
    district_party_sum = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    # year -> district -> party -> sum_vote_rate
    district_top_party = defaultdict(lambda: defaultdict(lambda: ("", 0.0)))
    # year -> district -> (top party, top vote_rate)

    for r in results:
        if r.region_sigungu is None:
            continue
        year = r.election_year
        district = r.region_sigungu
        party = _normalize_party(r.party)
        rate = r.vote_rate or 0
        district_party_sum[year][district][party] += rate
        by_year_districts[year].add(district)
        # 1위 후보 추적
        cur_top, cur_rate = district_top_party[year][district]
        if rate > cur_rate:
            district_top_party[year][district] = (party, rate)

    # 각 시군의 정당 합산을 by_year_party 평균에 반영
    for year, districts in district_party_sum.items():
        for district, parties in districts.items():
            for party, rate_sum in parties.items():
                by_year_party[year][party].append(rate_sum)
            top_party, _ = district_top_party[year][district]
            if top_party:
                by_year_district_winner[year][top_party] += 1

    # 시계열 정리
    by_year = []
    districts_won_by_year = []
    for year in sorted(by_year_party.keys()):
        parties = by_year_party[year]
        prog = parties.get("진보", [])
        cons = parties.get("보수", [])
        other_keys = [k for k in parties if k not in ("진보", "보수")]
        other = []
        for k in other_keys:
            other.extend(parties[k])

        by_year.append({
            "year": year,
            "progressive": round(sum(prog) / len(prog), 1) if prog else 0,
            "conservative": round(sum(cons) / len(cons), 1) if cons else 0,
            "other": round(sum(other) / len(other), 1) if other else 0,
        })

        won = by_year_district_winner[year]
        districts_won_by_year.append({
            "year": year,
            "progressive": won.get("진보", 0),
            "conservative": won.get("보수", 0),
            "other": sum(v for k, v in won.items() if k not in ("진보", "보수")),
        })

    # 추이 요약
    trend_summary = "데이터 부족"
    if len(by_year) >= 2:
        first = by_year[0]
        last = by_year[-1]
        prog_diff = last["progressive"] - first["progressive"]
        cons_diff = last["conservative"] - first["conservative"]
        last_gap = last["progressive"] - last["conservative"]
        dom = "진보" if last_gap > 0 else ("보수" if last_gap < 0 else "팽팽")
        trend_summary = (
            f"최근({last['year']}) {dom} 우세 격차 {abs(last_gap):.1f}%p · "
            f"진보 {prog_diff:+.1f}%p / 보수 {cons_diff:+.1f}%p ({first['year']}→{last['year']})"
        )

    return {
        "by_year": by_year,
        "districts_won_by_year": districts_won_by_year,
        "trend_summary": trend_summary,
    }


def _build_strength_grid(district_analysis: dict) -> dict:
    """v2: 시군 강세 5단계 분류 (히트맵용)."""
    cells = []
    legend_counts = {"prog_strong": 0, "prog_lean": 0, "swing": 0, "cons_lean": 0, "cons_strong": 0}

    for d in district_analysis.get("districts", []):
        gap = d.get("gap", 0)
        prog = d.get("progressive_rate", 0)
        cons = d.get("conservative_rate", 0)

        if prog > cons:
            tier = "prog_strong" if gap >= 15 else ("prog_lean" if gap >= 5 else "swing")
        elif cons > prog:
            tier = "cons_strong" if gap >= 15 else ("cons_lean" if gap >= 5 else "swing")
        else:
            tier = "swing"

        legend_counts[tier] += 1
        cells.append({
            "district": d["district"],
            "strength": tier,
            "margin": gap,
            "dominant": d.get("dominant"),
            "progressive_rate": prog,
            "conservative_rate": cons,
            "latest_year": d.get("latest_year"),
            "strength_rate": d.get("strength_rate", 0),
        })

    # 정렬: 진보 강세 → 진보 우세 → 경합 → 보수 우세 → 보수 강세
    tier_order = {"prog_strong": 0, "prog_lean": 1, "swing": 2, "cons_lean": 3, "cons_strong": 4}
    cells.sort(key=lambda c: (tier_order[c["strength"]], -c["margin"]))

    return {"cells": cells, "legend_counts": legend_counts}


def _build_district_drilldown(results: list) -> dict:
    """v2: 시군별 5회분 결과 묶음 (드릴다운 패널용)."""
    by_district = defaultdict(lambda: defaultdict(list))
    for r in results:
        if r.region_sigungu is None:
            continue
        by_district[r.region_sigungu][r.election_year].append(r)

    drilldown = {}
    for district, years in by_district.items():
        timeline = []
        for year in sorted(years.keys()):
            cands = sorted(years[year], key=lambda x: -(x.vote_rate or 0))
            top3 = [
                {
                    "name": c.candidate_name,
                    "party": c.party or "",
                    "party_camp": _normalize_party(c.party),
                    "vote_rate": c.vote_rate or 0,
                    "votes": c.votes or 0,
                    "is_winner": c.is_winner,
                }
                for c in cands[:3]
            ]
            margin = round((cands[0].vote_rate or 0) - (cands[1].vote_rate or 0), 1) if len(cands) > 1 else 0
            timeline.append({
                "year": year,
                "election_number": cands[0].election_number if cands else None,
                "top3": top3,
                "winner_party": top3[0]["party"] if top3 else "",
                "winner_camp": top3[0]["party_camp"] if top3 else "",
                "margin": margin,
                "candidates_count": len(cands),
            })
        drilldown[district] = timeline

    return drilldown


def _series_age_turnout(age_turnout: dict) -> list:
    """v2: 연령별 투표율을 차트용 시계열로 변환.

    Input: {"18-29": [{"year":2014,"turnout_rate":42.1}, ...], ...}
    Output: [{"age":"18-29","2014":42.1,"2018":48.3, ...}, ...]
    """
    series = []
    for age, rows in age_turnout.items():
        entry = {"age": age}
        for r in rows:
            year = r.get("year")
            if year is not None:
                entry[str(year)] = r.get("turnout_rate")
        series.append(entry)
    # 연령 순 정렬
    def age_key(e):
        s = e["age"].split("-")[0].replace("이상", "").strip()
        try:
            return int(s)
        except ValueError:
            return 999
    series.sort(key=age_key)
    return series


def _build_summary(
    winner_pattern: dict,
    district_analysis: dict,
    swing_analysis: dict,
    turnout_analysis: dict,
    ai_analysis: dict,
) -> dict:
    """v2: 한눈에 보기 6장 요약 카드."""
    elections = winner_pattern.get("elections", [])
    margins = [e.get("margin", 0) for e in elections if e.get("margin")]
    avg_margin = round(sum(margins) / len(margins), 1) if margins else 0

    # dominant_party는 정규화된 진영(진보/보수). 같은 정규화로 비교
    camps = [_normalize_party(e.get("winner", {}).get("party")) for e in elections if e.get("winner", {}).get("party")]
    dominant = winner_pattern.get("dominant_party", "불명")
    dom_pct = round(camps.count(dominant) / len(camps) * 100) if camps else 0

    total_districts = district_analysis.get("total_districts", 0)
    swing_count = swing_analysis.get("total_swing", 0)

    total_trend = turnout_analysis.get("total_trend", [])
    latest_turnout = total_trend[-1].get("total_rate") if total_trend else None

    # AI 핵심 액션 (있으면)
    structured = (ai_analysis or {}).get("structured") or {}
    top_actions = structured.get("top_actions") or []
    top_action_text = top_actions[0]["action"] if top_actions else None

    return {
        "elections_count": winner_pattern.get("total_elections", 0),
        "dominant_party": dominant,
        "dominant_pct": dom_pct,
        "avg_margin": avg_margin,
        "swing_count": swing_count,
        "total_districts": total_districts,
        "latest_turnout": latest_turnout,
        "top_action": top_action_text,
        "alternation_rate": winner_pattern.get("alternation_rate", 0),
    }


async def _load_cached_ai_strategy(db: AsyncSession, tenant_id, etype: str, region: str) -> dict:
    """v2: 캐시된 structured AI 전략 (없으면 빈 객체)."""
    cache_key = f"history_ai_v2_{etype}_{region}"
    cache = (await db.execute(
        select(AnalysisCache).where(
            AnalysisCache.tenant_id == tenant_id,
            AnalysisCache.analysis_type == cache_key,
        ).order_by(AnalysisCache.analysis_date.desc())
    )).scalars().first()

    if cache and cache.result_data:
        return cache.result_data

    return {"text": "", "ai_generated": False, "structured": None}


async def generate_history_ai_strategy(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
) -> dict:
    """v2: 4섹션 구조화 AI 전략 생성 (ai_service.call_claude_text 경유). 캐시 저장."""
    import json as _json
    from uuid import UUID as PyUUID

    try:
        tid_uuid = PyUUID(tenant_id) if isinstance(tenant_id, str) else tenant_id
    except ValueError:
        tid_uuid = tenant_id

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"text": "", "ai_generated": False, "structured": None, "error": "선거 정보 없음"}

    # 분석 데이터 (캐시된 v2 결과 사용)
    deep = await analyze_history_deep(db, str(tid_uuid), str(election_id))
    if deep.get("error"):
        return {"text": "", "ai_generated": False, "structured": None, "error": deep["error"]}

    sections = deep.get("sections", {})
    wp = sections.get("winner_pattern", {})
    da = sections.get("district_analysis", {})
    pt = sections.get("party_trend", {})
    sg = sections.get("strength_grid", {})
    sw = sections.get("swing_districts", {})
    ta = sections.get("turnout_analysis", {})
    pc = sections.get("political_context", {})

    # election-shared: tenant_elections 기준으로 우리 후보 찾기
    from app.common.election_access import get_our_candidate_id
    _my_id = await get_our_candidate_id(db, tenant_id, election.id)
    our = None
    if _my_id:
        our = (await db.execute(
            select(Candidate).where(Candidate.id == _my_id)
        )).scalar_one_or_none()

    # 강세/약세 시군 추출
    strong_districts = [c["district"] for c in sg.get("cells", []) if c["strength"] in ("prog_strong", "prog_lean")][:5]
    weak_districts = [c["district"] for c in sg.get("cells", []) if c["strength"] in ("cons_strong", "cons_lean")][:5]
    swing_districts = [s["district"] for s in sw.get("swing", [])][:5]

    factsheet = f"""
## 과거 선거 심층 팩트시트 — {election.region_sido} {election.election_type}

### 우리 후보
- 이름: {our.name if our else '미설정'}
- 정당: {our.party if our else '미설정'}

### 역대 패턴 ({wp.get('total_elections', 0)}회 분석)
{chr(10).join(f"- {e['year']}년: {e['winner']['name']} ({e['winner']['party']}) {e['winner']['vote_rate']}%, 격차 {e.get('margin',0)}%p" for e in wp.get('elections', []))}
- 우세 정당: {wp.get('dominant_party')} (교대율 {wp.get('alternation_rate', 0)}%)
- 패턴: {wp.get('pattern_summary')}

### 정당 추이
{pt.get('trend_summary', '')}

### 지역 강세 (5단계 분류)
- 진보 강세/우세 시군: {', '.join(strong_districts) or '없음'}
- 보수 강세/우세 시군: {', '.join(weak_districts) or '없음'}
- 스윙 시군: {', '.join(swing_districts) or '없음'}

### 투표율
- {ta.get('insight', '데이터 없음')}

### 정치 환경
- {pc.get('correlation_note', '데이터 없음')}
"""

    prompt = f"""당신은 한국 선거 전략 전문가입니다. 아래 팩트시트를 읽고 우리 후보({our.name if our else '미설정'})를 위한 4섹션 전략 분석을 작성하세요.

{factsheet}

**반드시 다음 JSON 형식으로만 응답하세요. 마크다운 코드블록(```)도 쓰지 말고, 순수 JSON만 출력하세요:**

{{
  "key_findings": [
    "핵심 발견 1 (1줄, 구체적 수치 포함)",
    "핵심 발견 2",
    "핵심 발견 3",
    "핵심 발견 4",
    "핵심 발견 5"
  ],
  "strength_strategy": "강세 지역에서 우리 후보가 어떻게 표를 굳힐 것인가 (3~5문장, 시군 이름 포함)",
  "weakness_strategy": "약세 지역을 어떻게 대응할 것인가 (3~5문장, 시군 이름 포함)",
  "top_actions": [
    {{"priority": "high", "action": "구체적 액션 1", "why": "근거"}},
    {{"priority": "high", "action": "구체적 액션 2", "why": "근거"}},
    {{"priority": "medium", "action": "구체적 액션 3", "why": "근거"}}
  ]
}}

규칙:
- 정직하게: 우리 후보가 불리한 점도 숨기지 말고 적시
- 시군 이름과 % 수치를 반드시 포함
- 추상적 미사여구 금지 ("열심히 한다" 같은 표현 X)
- 우리 후보 정당({our.party if our else '미설정'}) 관점에서 해석"""

    text = ""
    structured = None
    ai_generated = False

    try:
        # CLAUDE.md 절대 룰: subprocess.run(claude) 직접 호출 금지 → ai_service.call_claude_text 경유
        # (고객 API키 → 관리자 CLI 계정 → 시스템 CLI 자동 전환)
        from app.services.ai_service import call_claude_text
        raw = await call_claude_text(
            prompt,
            timeout=100,  # NPM 120초 이내로 안전하게
            context="history_ai_strategy",  # premium tier (Opus)
            tenant_id=str(tid_uuid),
            db=db,
        )
        if raw:
            text = raw.strip()
            # JSON 파싱 시도
            try:
                cleaned = text
                if cleaned.startswith("```"):
                    lines = cleaned.split("\n")
                    cleaned = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])
                structured = _json.loads(cleaned)
                ai_generated = True
            except Exception as parse_err:
                logger.warning("history_ai_json_parse_failed", error=str(parse_err), text_head=text[:200])
                ai_generated = True  # 텍스트는 살림
    except Exception as e:
        import traceback
        logger.warning("history_ai_failed", error=str(e), tb=traceback.format_exc()[:500])

    result_data = {
        "text": text,
        "structured": structured,
        "ai_generated": ai_generated,
        "factsheet": factsheet,
    }

    # 캐시 저장
    cache_key = f"history_ai_v2_{election.election_type}_{election.region_sido}"
    try:
        # 기존 캐시 삭제 (같은 키)
        from sqlalchemy import delete
        await db.execute(
            delete(AnalysisCache).where(
                AnalysisCache.tenant_id == tid_uuid,
                AnalysisCache.analysis_type == cache_key,
            )
        )
        db.add(AnalysisCache(
            tenant_id=tid_uuid,
            analysis_type=cache_key,
            analysis_date=date.today(),
            period_days=0,
            result_data=result_data,
        ))
        await db.commit()
    except Exception as e:
        logger.warning("history_ai_cache_failed", error=str(e))
        await db.rollback()

    return result_data


def _resolve_layout(etype: str) -> str:
    """election_type → layout."""
    if etype in ("mayor", "gun_head", "gu_head"):
        return "mayor"
    if etype == "governor":
        return "governor"
    if etype == "superintendent":
        return "superintendent"
    if etype in ("metro_council", "basic_council", "council"):
        return "council"
    if etype == "congressional":
        return "congressional"
    return "mayor"  # 기본


# 정당 색상 (raw 정당명 → hex)
_RAW_PARTY_COLORS = {
    "더불어민주당": "#1e40af",
    "민주당": "#1e40af",
    "새정치민주연합": "#2563eb",
    "열린우리당": "#3b82f6",
    "민주통합당": "#3b82f6",
    "국민의힘": "#dc2626",
    "자유한국당": "#dc2626",
    "새누리당": "#ef4444",
    "한나라당": "#f87171",
    "미래통합당": "#dc2626",
    "정의당": "#fbbf24",
    "진보당": "#fbbf24",
    "민주노동당": "#fbbf24",
    "녹색당": "#65a30d",
    "민중당": "#fbbf24",
    "노동당": "#fbbf24",
    "통합진보당": "#fbbf24",
    "기본소득당": "#a3e635",
    "국민의당": "#7c3aed",
    "바른미래당": "#7c3aed",
    "자유선진당": "#0ea5e9",
    "국민중심당": "#0ea5e9",
    "민주평화당": "#10b981",
    "무소속": "#6b7280",
}


def _color_for_party(party: str) -> str:
    if not party:
        return "#9ca3af"
    return _RAW_PARTY_COLORS.get(party.strip(), "#9ca3af")


def _analyze_raw_party_trend(results: list) -> dict:
    """v3: raw 정당명 그대로 시계열 분석 (시장/도지사용).

    Top N 정당만 추적, 나머지는 '기타'.
    """
    by_year_party = defaultdict(lambda: defaultdict(list))  # year -> party -> [vote_rate per district]
    party_total = defaultdict(float)  # party -> 누적 vote_rate (Top N 추출용)

    for r in results:
        if r.region_sigungu is None:
            continue
        year = r.election_year
        party = (r.party or "무소속").strip()
        rate = r.vote_rate or 0
        by_year_party[year][party].append(rate)
        party_total[party] += rate

    # Top 4 정당 + 기타
    top_parties = sorted(party_total.keys(), key=lambda p: -party_total[p])[:4]
    top_set = set(top_parties)

    by_year = []
    for year in sorted(by_year_party.keys()):
        row = {"year": year}
        other_rates = []
        for party, rates in by_year_party[year].items():
            avg = round(sum(rates) / len(rates), 1) if rates else 0
            if party in top_set:
                row[party] = avg
            else:
                other_rates.extend(rates)
        # 누락된 top party는 0으로
        for p in top_parties:
            if p not in row:
                row[p] = 0
        if other_rates:
            row["기타"] = round(sum(other_rates) / len(other_rates), 1)
        by_year.append(row)

    return {
        "by_year": by_year,
        "parties": top_parties,
        "colors": {p: _color_for_party(p) for p in top_parties + ["기타"]},
    }


def _build_raw_party_grid(results: list) -> dict:
    """v3: 시·군·구별 raw 정당 강세 (시장/도지사용).

    각 시군의 가장 최근 선거에서 1위 정당 + 누적 우세 정당.
    """
    by_district = defaultdict(lambda: defaultdict(list))  # district -> year -> rows

    for r in results:
        if r.region_sigungu is None:
            continue
        by_district[r.region_sigungu][r.election_year].append(r)

    cells = []
    party_counts = defaultdict(int)

    for district, years in by_district.items():
        # 최근 선거의 1위
        latest_year = max(years.keys())
        latest_winner = max(years[latest_year], key=lambda x: x.vote_rate or 0)
        latest_party = (latest_winner.party or "무소속").strip()
        latest_rate = latest_winner.vote_rate or 0

        # 누적 우세 정당 (전 회차 1위 횟수 많은 정당)
        winner_parties = []
        for year, rows in years.items():
            top = max(rows, key=lambda x: x.vote_rate or 0)
            winner_parties.append((top.party or "무소속").strip())
        from collections import Counter
        ctr = Counter(winner_parties)
        dom_party, dom_count = ctr.most_common(1)[0]
        dom_pct = round(dom_count / len(winner_parties) * 100)

        # 최근 1·2위 격차
        sorted_latest = sorted(years[latest_year], key=lambda x: -(x.vote_rate or 0))
        margin = round((sorted_latest[0].vote_rate or 0) - (sorted_latest[1].vote_rate or 0), 1) if len(sorted_latest) > 1 else 0

        party_counts[dom_party] += 1
        cells.append({
            "district": district,
            "latest_party": latest_party,
            "latest_rate": latest_rate,
            "latest_year": latest_year,
            "dominant_party": dom_party,
            "dominant_pct": dom_pct,
            "margin": margin,
            "color": _color_for_party(dom_party),
        })

    cells.sort(key=lambda c: (c["dominant_party"], -c["margin"]))

    return {
        "cells": cells,
        "party_counts": dict(party_counts),
    }


def _build_camp_grid(
    results: list,
    overrides: dict,
    alignments: dict,
) -> dict:
    """v3: 시·군·구별 진영(진보/보수) 분포 — 교육감용 + 백업.

    각 시군에서 진보 후보 합산 vs 보수 후보 합산.
    """
    by_district = defaultdict(lambda: defaultdict(list))

    for r in results:
        if r.region_sigungu is None:
            continue
        camp = lookup_camp(r.candidate_name, r.party, overrides, alignments)
        by_district[r.region_sigungu][r.election_year].append({
            "name": r.candidate_name, "camp": camp,
            "vote_rate": r.vote_rate or 0, "is_winner": r.is_winner,
        })

    cells = []
    legend = {"진보강세": 0, "진보우세": 0, "경합": 0, "보수우세": 0, "보수강세": 0}

    for district, years in by_district.items():
        # 각 회차 진보·보수 합산 → 전 회차 평균
        prog_per_year, cons_per_year = [], []
        for year, cands in years.items():
            prog_sum = sum(c["vote_rate"] for c in cands if c["camp"] == "진보")
            cons_sum = sum(c["vote_rate"] for c in cands if c["camp"] == "보수")
            if prog_sum or cons_sum:
                prog_per_year.append(prog_sum)
                cons_per_year.append(cons_sum)

        prog_avg = round(sum(prog_per_year) / len(prog_per_year), 1) if prog_per_year else 0
        cons_avg = round(sum(cons_per_year) / len(cons_per_year), 1) if cons_per_year else 0
        gap = round(abs(prog_avg - cons_avg), 1)
        dominant = "진보" if prog_avg > cons_avg else ("보수" if cons_avg > prog_avg else "경합")

        if dominant == "진보":
            tier = "진보강세" if gap >= 15 else ("진보우세" if gap >= 5 else "경합")
        elif dominant == "보수":
            tier = "보수강세" if gap >= 15 else ("보수우세" if gap >= 5 else "경합")
        else:
            tier = "경합"
        legend[tier] += 1

        # 최근 1위 후보 (이름 기준 — 교육감은 정당 X)
        latest_year = max(years.keys())
        latest_winner = max(years[latest_year], key=lambda x: x["vote_rate"])

        cells.append({
            "district": district,
            "tier": tier,
            "dominant": dominant,
            "progressive_rate": prog_avg,
            "conservative_rate": cons_avg,
            "gap": gap,
            "latest_winner": latest_winner["name"],
            "latest_winner_camp": latest_winner["camp"],
            "latest_year": latest_year,
        })

    tier_order = {"진보강세": 0, "진보우세": 1, "경합": 2, "보수우세": 3, "보수강세": 4}
    cells.sort(key=lambda c: (tier_order[c["tier"]], -c["gap"]))

    return {"cells": cells, "legend_counts": legend}


def _analyze_camp_trend(
    results: list,
    overrides: dict,
    alignments: dict,
) -> dict:
    """v3: 회차별 진영 평균 득표율 시계열 (진보/보수)."""
    by_year_camp = defaultdict(lambda: defaultdict(list))  # year -> camp -> [district sums]

    by_year_district_camp = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    # year -> district -> camp -> sum_vote_rate

    for r in results:
        if r.region_sigungu is None:
            continue
        camp = lookup_camp(r.candidate_name, r.party, overrides, alignments)
        by_year_district_camp[r.election_year][r.region_sigungu][camp] += (r.vote_rate or 0)

    for year, districts in by_year_district_camp.items():
        for district, camps in districts.items():
            for camp, total in camps.items():
                by_year_camp[year][camp].append(total)

    by_year = []
    for year in sorted(by_year_camp.keys()):
        camps = by_year_camp[year]
        prog = camps.get("진보", [])
        cons = camps.get("보수", [])
        center = camps.get("중도", [])
        by_year.append({
            "year": year,
            "progressive": round(sum(prog) / len(prog), 1) if prog else 0,
            "conservative": round(sum(cons) / len(cons), 1) if cons else 0,
            "centrist": round(sum(center) / len(center), 1) if center else 0,
        })

    summary = "데이터 부족"
    if len(by_year) >= 2:
        last = by_year[-1]
        gap = last["progressive"] - last["conservative"]
        dom = "진보" if gap > 0 else ("보수" if gap < 0 else "팽팽")
        summary = f"최근({last['year']}) {dom} 우세 {abs(gap):.1f}%p"

    return {"by_year": by_year, "summary": summary}


def _build_candidate_strongholds(results: list) -> dict:
    """v3: 후보별 시·군·구 강세 (교육감용).

    어떤 후보가 어떤 시군에서 압승했나 → 후보 인지도/지지 패턴.
    """
    by_candidate = defaultdict(list)  # name -> [{district, year, rate, is_winner}]

    for r in results:
        if r.region_sigungu is None:
            continue
        by_candidate[r.candidate_name].append({
            "district": r.region_sigungu,
            "year": r.election_year,
            "vote_rate": r.vote_rate or 0,
            "is_winner": r.is_winner,
            "party": r.party or "",
        })

    candidates = []
    for name, rows in by_candidate.items():
        if not rows:
            continue
        avg_rate = round(sum(r["vote_rate"] for r in rows) / len(rows), 1)
        wins = sum(1 for r in rows if r["is_winner"])
        # Top 3 강세 시군
        top_districts = sorted(rows, key=lambda r: -r["vote_rate"])[:3]
        candidates.append({
            "name": name,
            "appearances": len(rows),
            "wins": wins,
            "avg_rate": avg_rate,
            "best_districts": [
                {"district": r["district"], "year": r["year"], "rate": r["vote_rate"]}
                for r in top_districts
            ],
        })

    candidates.sort(key=lambda c: -c["avg_rate"])
    return {"candidates": candidates[:20]}  # Top 20 후보


def _find_unmapped_candidates(
    results: list,
    overrides: dict,
    alignments: dict,
) -> list:
    """v3: 진영 미매핑 후보 리스트 (교육감용 경고).

    historical_candidate_camps + party_alignment 둘 다 없고 정당도 비어있는 후보.
    """
    unmapped = set()
    for r in results:
        name = r.candidate_name
        if name in overrides or name in alignments:
            continue
        # 정당 정규화 결과가 '기타'면 미매핑
        camp = _normalize_party(r.party)
        if camp == "기타":
            unmapped.add(name)
    return sorted(unmapped)


async def _build_sigungu_turnout(db: AsyncSession, region: str) -> list:
    """v3: 시·군·구별 사전투표 vs 본투표 데이터.

    `early_voting` 테이블에서 직접 (election_type 무관, 지방선거 통합).
    """
    rows = (await db.execute(
        select(EarlyVoting).where(
            EarlyVoting.region_sido == region,
            EarlyVoting.region_sigungu.is_not(None),
        ).order_by(EarlyVoting.election_year.desc(), EarlyVoting.region_sigungu)
    )).scalars().all()

    result = []
    for r in rows:
        result.append({
            "year": r.election_year,
            "election_number": r.election_number,
            "district": r.region_sigungu,
            "total_rate": r.total_rate,
            "early_rate": r.early_rate,
            "election_day_rate": r.election_day_rate,
            "eligible": r.eligible_voters,
        })
    return result


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

    # 우리 후보 정보 (deprecated helper — tenant_id 컨텍스트 없음, legacy election.our_candidate_id 사용)
    our = None
    if election.our_candidate_id:
        our = (await db.execute(
            select(Candidate).where(Candidate.id == election.our_candidate_id)
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
5. 핵심 대응 지역 TOP 3과 이유
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
