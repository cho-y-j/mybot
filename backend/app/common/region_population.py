"""
ElectionPulse - 지역별 인구 + 선거인 + 영향력 점수 헬퍼

데이터 출처:
- admin_population: KOSIS 읍·면·동 단위 등록 인구 (3,910 동)
- voter_turnout: NEC 시·도 단위 선거인수/투표자수
- election_results / election_results_dong: 후보별 시·군·구·동 단위 표

선거인 추정 (읍·면·동 단위):
- voter_turnout은 시·군·구 단위가 비어있어 동 단위 직접 데이터 없음
- 시·도 단위 (선거인수 / 인구) 비율을 동 인구에 곱해 추정
- 예: 충북 인구 160만, 선거인 137만 → 비율 0.857
       동 인구 1,000명 → 선거인 추정 857명
- 오차 1~3% 내, 캠프 전략 의사결정에 충분

영향력 점수:
- |1위 표 - 2위 표| × (선거인 / 시·도 평균 선거인) — 인구 큰 지역 우위
- 또는 단순 |gap| 자체
"""
from typing import Optional

from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession


# KOSIS / 통계청 시·도 코드 (admin_population.sido_cd, GeoJSON sido)
SIDO_CD_TO_NAME: dict[str, str] = {
    "11": "서울특별시",
    "26": "부산광역시",
    "27": "대구광역시",
    "28": "인천광역시",
    "29": "광주광역시",
    "30": "대전광역시",
    "31": "울산광역시",
    "36": "세종특별자치시",
    "41": "경기도",
    "42": "강원특별자치도",
    "43": "충청북도",
    "44": "충청남도",
    "45": "전북특별자치도",
    "46": "전라남도",
    "47": "경상북도",
    "48": "경상남도",
    "50": "제주특별자치도",
}
SIDO_NAME_TO_CD: dict[str, str] = {v: k for k, v in SIDO_CD_TO_NAME.items()}


async def get_voter_ratio(
    db: AsyncSession,
    sido_name: str,
    election_year: int,
    election_type: str,
) -> float:
    """시·도별 (선거인수 / 인구) 비율 반환. 동 단위 선거인 추정의 곱셈 인자.

    voter_turnout이 비어있는 시·도면 전국 평균 비율 0.82 사용 (안전 fallback).
    """
    voters = (await db.execute(sql_text("""
        SELECT MAX(eligible_voters) AS v
          FROM voter_turnout
         WHERE region_sido = :sido
           AND election_year = :year
           AND eligible_voters > 0
           AND region_sigungu IS NULL
    """), {"sido": sido_name, "year": election_year})).scalar()

    if not voters or voters <= 0:
        # election_type 무시하고 같은 연도 다른 타입 fallback
        voters = (await db.execute(sql_text("""
            SELECT MAX(eligible_voters) AS v
              FROM voter_turnout
             WHERE region_sido = :sido
               AND eligible_voters > 0
               AND region_sigungu IS NULL
        """), {"sido": sido_name})).scalar()

    sido_cd = SIDO_NAME_TO_CD.get(sido_name)
    pop_total = 0
    if sido_cd:
        pop_total = (await db.execute(sql_text("""
            SELECT COALESCE(SUM(total), 0) FROM admin_population
             WHERE level = 10 AND sido_cd = :cd
        """), {"cd": sido_cd})).scalar() or 0

    if voters and voters > 0 and pop_total > 0:
        ratio = float(voters) / float(pop_total)
        # 안전 클램프: 0.6 ~ 0.95 범위 밖이면 fallback
        if 0.6 <= ratio <= 0.95:
            return ratio
    return 0.82  # 전국 평균 fallback


async def get_heatmap_stats(
    db: AsyncSession,
    election_year: int,
    election_type: str,
    region_sido: Optional[str] = None,
    our_party_aliases: Optional[list[str]] = None,
) -> dict:
    """3단(시·도/시·군·구/읍·면·동) 영향력 히트맵 데이터.

    반환:
        {
          "voter_ratio": 0.857,
          "sido": [{name, sido_cd, population, voters_est, top1, top2, gap, our_score}],
          "sigungu": [{name, sgg_cd, population, voters_est, top1, top2, gap, our_score}],
          "dong": [{adm_cd, adm_nm, sido_cd, sgg_cd, population, voters_est, top1, top2, gap, our_score}],
        }

    our_party_aliases: 예 ["더불어민주당", "민주당"] 같은 진영 매칭. 없으면 our_score=None.
    """
    voter_ratio = (await get_voter_ratio(db, region_sido, election_year, election_type)
                   if region_sido else 0.82)

    sido_cd_filter = SIDO_NAME_TO_CD.get(region_sido) if region_sido else None

    # 1. 동 단위 인구 (admin_population)
    pop_q = """
        SELECT adm_cd, adm_nm, sido_cd, sigungu_cd, total
          FROM admin_population
         WHERE level = 10
    """
    params: dict = {}
    if sido_cd_filter:
        pop_q += " AND sido_cd = :sd"
        params["sd"] = sido_cd_filter

    pop_rows = (await db.execute(sql_text(pop_q), params)).mappings().all()

    # 2. 동 단위 표 (election_results_dong) — 한 동의 후보별 표
    dong_q = """
        SELECT region_sido, region_sigungu, eup_myeon_dong, candidate_name, party, votes
          FROM election_results_dong
         WHERE election_year = :y AND election_type = :t
    """
    dong_params: dict = {"y": election_year, "t": election_type}
    if region_sido:
        dong_q += " AND region_sido = :rs"
        dong_params["rs"] = region_sido
    dong_votes = (await db.execute(sql_text(dong_q), dong_params)).mappings().all()

    # 동 단위 1·2위 + gap 계산
    dong_top: dict[tuple[str, str, str], dict] = {}  # (sido, sigungu, dong) → top stats
    dong_grouped: dict[tuple[str, str, str], list[dict]] = {}
    for r in dong_votes:
        k = (r["region_sido"], r["region_sigungu"] or "", r["eup_myeon_dong"])
        dong_grouped.setdefault(k, []).append({
            "name": r["candidate_name"],
            "party": r["party"],
            "votes": r["votes"] or 0,
        })

    for k, candidates in dong_grouped.items():
        candidates.sort(key=lambda x: x["votes"], reverse=True)
        top1 = candidates[0]
        top2 = candidates[1] if len(candidates) > 1 else None
        gap = (top1["votes"] - top2["votes"]) if top2 else top1["votes"]
        our_score = None
        if our_party_aliases:
            our = next((c for c in candidates if c["party"] and c["party"] in our_party_aliases), None)
            if our:
                # 우리 진영 표 - 1위 표 (음수면 우리 패, 양수면 우리 우세)
                our_score = our["votes"] - top1["votes"] if our["name"] != top1["name"] else gap
        dong_top[k] = {
            "top1": top1,
            "top2": top2,
            "gap": gap,
            "our_score": our_score,
            "total_votes": sum(c["votes"] for c in candidates),
        }

    # 3. 동 stats 결합 (인구 + 선거인 + 표)
    # adm_nm "청운효자동" 만 있어 election_results_dong "청운효자동"과 매칭
    dong_stats = []
    for p in pop_rows:
        sido_cd = p["sido_cd"]
        sido_name = SIDO_CD_TO_NAME.get(sido_cd, "")
        # election_results_dong은 region_sigungu 형식이 "청주시상당구" 같은 합성. 매칭 어려움
        # 우선 동 이름으로만 매칭 시도 (sido + dong)
        match = None
        for (rs_sido, rs_sigungu, rs_dong), top in dong_top.items():
            if rs_sido == sido_name and rs_dong == p["adm_nm"]:
                match = top
                break
        voters_est = int(p["total"] * voter_ratio)
        dong_stats.append({
            "adm_cd": p["adm_cd"],
            "adm_nm": p["adm_nm"],
            "sido_cd": sido_cd,
            "sigungu_cd": p["sigungu_cd"],
            "population": p["total"],
            "voters_est": voters_est,
            "top1": match["top1"] if match else None,
            "top2": match["top2"] if match else None,
            "gap": match["gap"] if match else None,
            "our_score": match["our_score"] if match else None,
            "total_votes": match["total_votes"] if match else None,
            "turnout_est": round(match["total_votes"] / voters_est * 100, 1)
                if (match and voters_est > 0) else None,
        })

    # 4. 시·군·구 단위 집계
    sigungu_q = """
        SELECT region_sido, region_sigungu, candidate_name, party, votes
          FROM election_results
         WHERE election_year = :y AND election_type = :t
           AND region_sigungu IS NOT NULL
    """
    sigungu_params: dict = {"y": election_year, "t": election_type}
    if region_sido:
        sigungu_q += " AND region_sido = :rs"
        sigungu_params["rs"] = region_sido
    sigungu_votes = (await db.execute(sql_text(sigungu_q), sigungu_params)).mappings().all()

    sigungu_grouped: dict[tuple[str, str], list[dict]] = {}
    for r in sigungu_votes:
        k = (r["region_sido"], r["region_sigungu"])
        sigungu_grouped.setdefault(k, []).append({
            "name": r["candidate_name"],
            "party": r["party"],
            "votes": r["votes"] or 0,
        })

    # 시·군·구 단위 인구 합산 (adm_cd 앞 5자리 = sgg)
    sigungu_pop: dict[str, int] = {}
    for p in pop_rows:
        sgg = p["sigungu_cd"]
        if sgg:
            sigungu_pop[sgg] = sigungu_pop.get(sgg, 0) + p["total"]

    sigungu_stats = []
    for (sido_name, sigungu_name), candidates in sigungu_grouped.items():
        candidates.sort(key=lambda x: x["votes"], reverse=True)
        top1 = candidates[0]
        top2 = candidates[1] if len(candidates) > 1 else None
        gap = (top1["votes"] - top2["votes"]) if top2 else top1["votes"]
        our_score = None
        if our_party_aliases:
            our = next((c for c in candidates if c["party"] and c["party"] in our_party_aliases), None)
            if our:
                our_score = our["votes"] - top1["votes"] if our["name"] != top1["name"] else gap
        # sgg 코드는 sido_name 매칭 + 같은 sido 안에서 sgg 이름 약식 매칭 어렵
        # admin_population.adm_nm 은 동만 있어서 시·군·구 매칭 불가 → 코드 기반은 GeoJSON에서
        sigungu_stats.append({
            "name": sigungu_name,
            "sido_name": sido_name,
            "top1": top1,
            "top2": top2,
            "gap": gap,
            "our_score": our_score,
            "total_votes": sum(c["votes"] for c in candidates),
        })

    # 5. 시·도 단위 집계
    sido_grouped: dict[str, list[dict]] = {}
    for r in sigungu_votes:
        sido_grouped.setdefault(r["region_sido"], []).extend([
            {"name": r["candidate_name"], "party": r["party"], "votes": r["votes"] or 0}
        ])

    sido_pop: dict[str, int] = {}
    for p in pop_rows:
        sd = p["sido_cd"]
        if sd:
            sido_pop[sd] = sido_pop.get(sd, 0) + p["total"]

    sido_stats = []
    for sido_name, all_candidates in sido_grouped.items():
        # 후보별 시·도 합산
        agg: dict[str, dict] = {}
        for c in all_candidates:
            key = c["name"]
            if key not in agg:
                agg[key] = {"name": c["name"], "party": c["party"], "votes": 0}
            agg[key]["votes"] += c["votes"]
        candidates = sorted(agg.values(), key=lambda x: x["votes"], reverse=True)
        if not candidates:
            continue
        top1 = candidates[0]
        top2 = candidates[1] if len(candidates) > 1 else None
        gap = (top1["votes"] - top2["votes"]) if top2 else top1["votes"]
        our_score = None
        if our_party_aliases:
            our = next((c for c in candidates if c["party"] and c["party"] in our_party_aliases), None)
            if our:
                our_score = our["votes"] - top1["votes"] if our["name"] != top1["name"] else gap
        sido_cd = SIDO_NAME_TO_CD.get(sido_name)
        pop = sido_pop.get(sido_cd, 0) if sido_cd else 0
        sido_stats.append({
            "name": sido_name,
            "sido_cd": sido_cd,
            "population": pop,
            "voters_est": int(pop * voter_ratio),
            "top1": top1,
            "top2": top2,
            "gap": gap,
            "our_score": our_score,
            "total_votes": sum(c["votes"] for c in candidates),
        })

    return {
        "voter_ratio": round(voter_ratio, 3),
        "sido": sido_stats,
        "sigungu": sigungu_stats,
        "dong": dong_stats,
    }
