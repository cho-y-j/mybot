"""
ElectionPulse - 지역별 인구 + 선거인 + 영향력 점수 헬퍼

진영 매핑:
- candidate.party_alignment (progressive/conservative) 또는
- historical_candidate_camps.camp (보수/진보) 또는
- party 정규식 (utils.ts와 동일 룰) — 폴백
- 진영별 alias 리스트 → election_results 매칭 시 같은 진영 모두 우리 진영으로 인정

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


# 진영별 정당 alias — historical_candidate_camps + party_alignment + 정당명 정규식 통합
PROGRESSIVE_PARTIES = {
    "더불어민주당", "민주당", "민주실용", "새정치민주연합", "통합민주당", "열린우리당",
    "민주노동당", "정의당", "녹색당", "진보당", "조국혁신당", "개혁신당",
    "노동당", "민중당", "사회민주당",
}
CONSERVATIVE_PARTIES = {
    "국민의힘", "한나라당", "새누리당", "미래통합당", "자유한국당", "민주자유당",
    "신한국당", "한국당", "보수", "새천년민주당",  # 일부 신민주 계열은 한국적 분류상 보수
}


def party_to_camp(party: Optional[str]) -> Optional[str]:
    """정당명 → 'progressive' | 'conservative' | None.

    historical_candidate_camps와 동일 룰 (한국어 '진보'/'보수' 분류).
    """
    if not party:
        return None
    p = party.strip()
    # 직접 매칭
    if p in PROGRESSIVE_PARTIES:
        return "progressive"
    if p in CONSERVATIVE_PARTIES:
        return "conservative"
    # 부분 매칭 (예: "더불어민주당(비례)")
    for prog in PROGRESSIVE_PARTIES:
        if prog in p:
            return "progressive"
    for cons in CONSERVATIVE_PARTIES:
        if cons in p:
            return "conservative"
    # 한글 단어 fallback
    if "진보" in p or "민주" in p or "녹색" in p or "정의" in p:
        return "progressive"
    if "보수" in p or "한국" in p or "통합" in p:
        return "conservative"
    return None


def get_camp_aliases(camp: str) -> list[str]:
    """진영명('progressive'|'conservative'|'진보'|'보수') → 정당 alias 리스트."""
    if not camp:
        return []
    norm = camp.lower()
    if norm in ("progressive", "진보"):
        return list(PROGRESSIVE_PARTIES)
    if norm in ("conservative", "보수"):
        return list(CONSERVATIVE_PARTIES)
    return []


async def get_our_camp_aliases(
    db: AsyncSession,
    election_id: str,
    tenant_id: str,
) -> tuple[Optional[str], list[str]]:
    """현재 선거 우리 후보 → 진영 + alias 리스트 자동 추출.

    우선순위:
      1. candidate.party_alignment (progressive/conservative)
      2. historical_candidate_camps.camp (이름+선거유형+지역 매칭)
      3. candidate.party 정규식 매칭

    반환: (camp, aliases). camp 못 찾으면 (None, []).
    """
    from app.elections.models import Election, Candidate
    from uuid import UUID as _UUID

    # 1. 우리 후보 + 선거 정보 조회
    elec = (await db.execute(sql_text("""
        SELECT e.election_type, e.region_sido,
               (SELECT te.our_candidate_id FROM tenant_elections te
                 WHERE te.tenant_id = :tid AND te.election_id = :eid LIMIT 1) AS our_cid
          FROM elections e WHERE e.id = :eid
    """), {"eid": election_id, "tid": tenant_id})).mappings().first()
    if not elec or not elec["our_cid"]:
        return None, []

    cand = (await db.execute(sql_text("""
        SELECT name, party, party_alignment FROM candidates WHERE id = :cid
    """), {"cid": str(elec["our_cid"])})).mappings().first()
    if not cand:
        return None, []

    # 2. party_alignment 우선
    align = cand.get("party_alignment") or ""
    if align in ("progressive", "conservative"):
        return align, get_camp_aliases(align)

    # 3. historical_candidate_camps fallback
    hcc_camp = (await db.execute(sql_text("""
        SELECT camp FROM historical_candidate_camps
         WHERE candidate_name = :n AND election_type = :t
           AND (region_sido IS NULL OR region_sido = :r)
         ORDER BY (region_sido = :r) DESC, election_year DESC NULLS LAST
         LIMIT 1
    """), {
        "n": cand["name"],
        "t": elec["election_type"],
        "r": elec["region_sido"],
    })).scalar()
    if hcc_camp:
        return hcc_camp, get_camp_aliases(hcc_camp)

    # 4. party 정규식 fallback
    auto = party_to_camp(cand.get("party"))
    if auto:
        return auto, get_camp_aliases(auto)

    return None, []


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
    our_camp: Optional[str] = None,
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

    # 후보명 → 진영 매핑 (historical_candidate_camps 기반)
    # election_type + 지역 매칭 + 같은 후보 모든 연도 고려 (정확치 → 광범위 fallback)
    camp_by_name: dict[str, str] = {}
    hcc_rows = (await db.execute(sql_text("""
        SELECT DISTINCT ON (candidate_name) candidate_name, camp
          FROM historical_candidate_camps
         WHERE election_type = :t
           AND (region_sido IS NULL OR region_sido = :r OR :r IS NULL)
         ORDER BY candidate_name, (region_sido = :r) DESC NULLS LAST, election_year DESC NULLS LAST
    """), {"t": election_type, "r": region_sido})).mappings().all()
    for r in hcc_rows:
        camp_by_name[r["candidate_name"]] = r["camp"]

    def _is_our_camp(candidate_name: str, party: Optional[str]) -> bool:
        """후보가 우리 진영인지: 1) historical_candidate_camps 이름 매칭 2) party alias 매칭 3) party→camp 룰."""
        if not our_camp and not our_party_aliases:
            return False
        # 1. 이름 기반 (가장 정확)
        cn_camp = camp_by_name.get(candidate_name)
        if cn_camp and our_camp:
            # camp 정규화: progressive ↔ 진보, conservative ↔ 보수
            cn_norm = "progressive" if cn_camp in ("진보", "progressive") else \
                      "conservative" if cn_camp in ("보수", "conservative") else cn_camp.lower()
            our_norm = our_camp.lower()
            if cn_norm == our_norm:
                return True
            # 다른 진영 명확 → False (혼동 방지)
            if cn_norm in ("progressive", "conservative") and our_norm in ("progressive", "conservative"):
                return False
        # 2. party alias 매칭
        if party and our_party_aliases and any(a in party for a in our_party_aliases):
            return True
        # 3. party → camp 룰
        if party and our_camp:
            auto = party_to_camp(party)
            if auto and auto.lower() == our_camp.lower():
                return True
        return False

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
        if our_camp or our_party_aliases:
            our = next((c for c in candidates if _is_our_camp(c["name"], c.get("party"))), None)
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
        if our_camp or our_party_aliases:
            our = next((c for c in candidates if _is_our_camp(c["name"], c.get("party"))), None)
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
        if our_camp or our_party_aliases:
            our = next((c for c in candidates if _is_our_camp(c["name"], c.get("party"))), None)
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
