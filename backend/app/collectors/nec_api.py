"""
ElectionPulse - 선관위 공공데이터 API 연동
역대 선거 결과, 투표율, 선거공약 자동 수집
"""
from urllib.parse import quote
from typing import Optional
import httpx
import structlog
from sqlalchemy import text

from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()


class NECApiClient:
    """중앙선거관리위원회 공공데이터 API 클라이언트."""

    def __init__(self):
        self.api_key = settings.NEC_API_KEY
        self.timeout = 15

    async def _get(self, base_url: str, operation: str, params: dict) -> list[dict]:
        """API 공통 호출."""
        params["serviceKey"] = self.api_key
        params["resultType"] = "json"
        params.setdefault("numOfRows", 100)
        params.setdefault("pageNo", 1)

        url = f"{base_url}/{operation}"

        async with httpx.AsyncClient(follow_redirects=True) as client:
            try:
                resp = await client.get(url, params=params, timeout=self.timeout)
                if resp.status_code != 200:
                    logger.error("nec_api_error", status=resp.status_code, url=url, body=resp.text[:200])
                    return []

                data = resp.json()
                body = data.get("response", {}).get("body", {})
                items = body.get("items", {})

                if isinstance(items, dict):
                    item_list = items.get("item", [])
                    if isinstance(item_list, dict):
                        return [item_list]
                    return item_list
                return []

            except Exception as e:
                logger.error("nec_api_exception", error=str(e), url=url)
                return []

    # ──────── 개표 결과 (모든 선거 통합 — VoteXmntckInfoInqireService2) ──────────

    async def get_xmntck_results(
        self, sg_id: str, sg_typecode: str,
        sd_name: str = None, wiw_name: str = None, sgg_name: str = None,
    ) -> list[dict]:
        """
        개표 결과 조회 (대통령/국회의원/지방선거 모두).
        엔드포인트: VoteXmntckInfoInqireService2/getXmntckSttusInfoInqire
        sg_id: 선거ID (선거일 8자리, 예: "20220601" = 제8회 지방선거)
        sg_typecode (NEC 공식):
          1=대통령, 2=국회의원(지역구),
          3=시도지사, 4=시·군·구의 장(시장/군수/구청장),
          5=시·도의원, 6=구·시·군의원,
          7=비례대표 국회의원, 8=비례대표 시·도의원, 9=비례대표 구·시·군의원
          (교육감은 별도 sgTypecode가 다를 수 있음)
        sd_name: 시도명 (예: "충청북도")
        wiw_name: 구시군명 (예: "청주시" — 특정 시·군 결과가 있으면)
        sgg_name: 선거구명 (국회의원 등에서 사용)

        응답은 wide format: 한 row에 hbj01..hbj50, jd01..jd50, dugsu01..dugsu50.
        파싱은 fetch_and_store_history에서 unwind.
        """
        params = {"sgId": sg_id, "sgTypecode": sg_typecode, "numOfRows": 100, "pageNo": 1}
        if sd_name:
            params["sdName"] = sd_name
        if wiw_name:
            params["wiwName"] = wiw_name
        if sgg_name:
            params["sggName"] = sgg_name

        return await self._get(
            settings.NEC_LOCAL_ELECTION_URL,
            "getXmntckSttusInfoInqire",
            params,
        )

    # 호환 alias (기존 호출처)
    async def get_local_election_results(
        self, sg_id: str, sg_typecode: str,
        sd_name: str = None, wiw_name: str = None,
    ) -> list[dict]:
        return await self.get_xmntck_results(sg_id, sg_typecode, sd_name, wiw_name)

    async def get_all_local_elections(self, sd_name: str, election_type: str = "7") -> dict:
        """
        특정 지역의 역대 지방선거 전체 결과.
        제3회(1998)~제8회(2022) 자동 수집.
        """
        # 역대 지방선거 ID
        election_ids = {
            3: "19980604", 4: "20020613", 5: "20060531",
            6: "20100602", 7: "20140604", 8: "20220601",
        }

        all_results = {}
        for num, sg_id in election_ids.items():
            results = await self.get_local_election_results(sg_id, election_type, sd_name)
            if results:
                all_results[f"제{num}회({sg_id[:4]})"] = results
                logger.info("nec_local_fetched", election=num, region=sd_name, count=len(results))

        return all_results

    # ──────── 투표율 (시·군·구별) ──────────

    async def get_vote_turnout(
        self, sg_id: str, sg_typecode: str, sd_name: str = None,
    ) -> list[dict]:
        """투표율 조회 (`getVoteSttusInfoInqire`).

        지방선거는 sgTypecode=3 하나로 호출하면 시군별 투표율 + 사전·거소 투표 데이터 모두 획득.
        대선은 1, 총선은 2(또는 7).

        응답 필드: wiwName, totSunsu(선거인수), psSunsu(선거일선거인수),
        psEtcSunsu(거소·사전·선상·재외 선거인수), totTusu(총투표자수),
        psTusu(선거일투표자수), psEtcTusu(사전·거소 투표자수), turnout(투표율)
        """
        params = {"sgId": sg_id, "sgTypecode": sg_typecode, "numOfRows": 100, "pageNo": 1}
        if sd_name:
            params["sdName"] = sd_name

        return await self._get(
            settings.NEC_LOCAL_ELECTION_URL,
            "getVoteSttusInfoInqire",
            params,
        )

    # ──────── 역대 대통령선거 ──────────

    async def get_president_election_results(self, sg_id: str, sd_name: str = None) -> list[dict]:
        """역대 대통령선거 결과."""
        params = {"sgId": sg_id}
        if sd_name:
            params["sdName"] = sd_name

        return await self._get(
            settings.NEC_PRESIDENT_ELECTION_URL,
            "getScgnPresElctExctSttnInqire",
            params,
        )

    # ──────── 역대 국회의원선거 ──────────

    async def get_congress_election_results(self, sg_id: str, sd_name: str = None) -> list[dict]:
        """역대 국회의원선거 결과."""
        params = {"sgId": sg_id}
        if sd_name:
            params["sdName"] = sd_name

        return await self._get(
            settings.NEC_CONGRESS_ELECTION_URL,
            "getScgnConElctExctSttnInqire",
            params,
        )

    # ──────── 선거공약 ──────────

    async def get_election_pledges(
        self, sg_id: str, sg_typecode: str,
        sd_name: str = None, candidate_name: str = None,
    ) -> list[dict]:
        """
        선거공약 정보 조회.
        후보별 공약을 자동으로 수집!
        """
        params = {"sgId": sg_id, "sgTypecode": sg_typecode}
        if sd_name:
            params["sdName"] = sd_name
        if candidate_name:
            params["name"] = candidate_name

        return await self._get(
            settings.NEC_PLEDGE_URL,
            "getElecPrmsInfoList",
            params,
        )


# 선거종류 코드 매핑 (선관위 NEC 공식 sgTypecode — 가이드 v4.3 기준)
ELECTION_TYPE_CODES = {
    "congressional": "2",   # 국회의원 (지역구)
    "governor": "3",        # 시·도지사
    "mayor": "4",           # 시장 (기초단체장)
    "gun_head": "4",        # 군수 (기초단체장 — 같은 코드)
    "gu_head": "4",         # 구청장 (자치구 — 같은 코드)
    "metro_council": "5",   # 시·도의원 (광역의원)
    "council_sido": "5",    # 호환
    "basic_council": "6",   # 구·시·군의원 (기초의원)
    "council": "6",         # 호환
    "superintendent": "11", # 교육감 (NEC 검증: sgTypecode=11, 정당 없이 후보명만 반환)
}

# 역대 지방선거 ID (NEC sgId — 선거일 8자리, API로 검증됨)
LOCAL_ELECTION_IDS = {
    5: "20060531",  # 제4회 지방선거 (2006)
    6: "20100602",  # 제5회 (2010)
    7: "20140604",  # 제6회 (2014) ✅ NEC 검증
    8: "20180613",  # 제7회 (2018) ✅ NEC 검증
    9: "20220601",  # 제8회 (2022) ✅ NEC 검증
}

# 역대 대통령선거 ID
PRESIDENT_ELECTION_IDS = {
    15: "19971218",
    16: "20021219",
    17: "20071219",
    18: "20121219",
    19: "20170509",
    20: "20220309",
    21: "20250603",  # 2025 대선
}


async def fetch_and_store_history(
    db_session,
    region_sido: str,
    election_type: str,
    tenant_id: str = None,
) -> dict:
    """
    역대 선거 결과 자동 수집 + DB 저장.

    NEC 응답은 wide format (한 row = 한 시군구, 후보자는 hbj01..50 / dugsu01..50 컬럼).
    이를 candidate별 row로 unwind 해서 election_results에 저장한다.

    공공 데이터이므로 tenant_id=None 으로 저장 → 모든 캠프 자동 공유.
    (호출자가 tenant_id를 넘기더라도 무시하고 NULL로 저장 — 의미상 공공 자산)
    """
    from app.elections.history_models import ElectionResult

    client = NECApiClient()
    type_code = ELECTION_TYPE_CODES.get(election_type, "3")  # default: 시도지사

    total_imported = 0
    elections_found = 0
    skipped_existing = 0

    from sqlalchemy import select as sa_select

    for num, sg_id in LOCAL_ELECTION_IDS.items():
        rows = await client.get_xmntck_results(sg_id, type_code, region_sido)
        if not rows:
            continue

        elections_found += 1
        year = int(sg_id[:4])

        for row in rows:
            wiw_name = row.get("wiwName")
            sgg_name = row.get("sggName")
            # 시·군·구 식별 (합계 row 무시)
            if wiw_name in ("합계", None, ""):
                # 시·도지사처럼 도 단위인 경우는 region_sigungu 없는 행으로 의미 있음
                if type_code == "3":
                    region_sigungu = None
                else:
                    continue
            else:
                region_sigungu = wiw_name

            # hbj01..hbj50 / jd01..jd50 / dugsu01..dugsu50 unwind
            for i in range(1, 51):
                idx = f"{i:02d}"
                name = row.get(f"hbj{idx}")
                if not name:
                    continue
                party = row.get(f"jd{idx}") or ""
                votes_raw = row.get(f"dugsu{idx}") or 0
                try:
                    votes = int(votes_raw)
                except (TypeError, ValueError):
                    votes = 0

                # 득표율 계산 (NEC는 dugyul 안 줌 — 직접 계산)
                yutusu_raw = row.get("yutusu") or 0
                try:
                    yutusu = int(yutusu_raw)
                except (TypeError, ValueError):
                    yutusu = 0
                vote_rate = round(votes / yutusu * 100, 2) if yutusu > 0 else 0.0

                # 중복 방지 (tenant_id NULL로 통일된 공공 데이터)
                exists = (await db_session.execute(
                    sa_select(ElectionResult).where(
                        ElectionResult.election_year == year,
                        ElectionResult.election_type == election_type,
                        ElectionResult.region_sido == region_sido,
                        ElectionResult.region_sigungu == region_sigungu,
                        ElectionResult.candidate_name == name,
                    )
                )).scalar_one_or_none()
                if exists:
                    skipped_existing += 1
                    continue

                db_session.add(ElectionResult(
                    tenant_id=None,  # 공공 데이터 — 모든 캠프 공유
                    election_number=num,
                    election_type=election_type,
                    election_year=year,
                    region_sido=region_sido,
                    region_sigungu=region_sigungu,
                    candidate_name=name,
                    candidate_number=i,
                    party=party,
                    votes=votes,
                    vote_rate=vote_rate,
                    is_winner=False,  # 결정은 후처리 (시군구별 max)
                ))
                total_imported += 1

    # is_winner 후처리: 시군구별로 vote_rate 최대값
    if total_imported > 0:
        await db_session.execute(text("""
            WITH ranked AS (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY election_year, election_type, region_sido, region_sigungu
                    ORDER BY votes DESC NULLS LAST
                ) as rn
                FROM election_results
                WHERE election_type = :etype AND region_sido = :region
            )
            UPDATE election_results SET is_winner = TRUE
            WHERE id IN (SELECT id FROM ranked WHERE rn = 1)
        """), {"etype": election_type, "region": region_sido})

    logger.info("nec_history_imported", region=region_sido, type=election_type,
                elections=elections_found, records=total_imported, skipped=skipped_existing)

    return {
        "elections_found": elections_found,
        "records_imported": total_imported,
        "skipped_existing": skipped_existing,
        "region": region_sido,
        "type": election_type,
    }


# 지방선거 회차 → sgId (개표결과와 동일하지만 turnout 수집용)
LOCAL_TURNOUT_SG_IDS = LOCAL_ELECTION_IDS  # 같은 sgId 사용


async def fetch_and_store_turnout(
    db_session,
    region_sido: str,
    target_election_type: str = "local",
) -> dict:
    """역대 지방선거 시·군·구별 투표율 + 사전투표 자동 수집.

    `getVoteSttusInfoInqire`를 sgTypecode=3 (umbrella)으로 호출하면
    한 번에 시군구별 투표율 + 사전·거소 투표 데이터 모두 받음.

    저장 위치:
      - voter_turnout (segment="합계", category="district"): 시군별 총 투표율
      - early_voting: 시군별 사전+거소 투표 데이터

    공공 데이터 → tenant_id=NULL.
    """
    from app.elections.history_models import VoterTurnout, EarlyVoting

    client = NECApiClient()

    total_voter_rows = 0
    total_early_rows = 0
    elections_found = 0
    skipped = 0

    from sqlalchemy import select as sa_select

    for num, sg_id in LOCAL_TURNOUT_SG_IDS.items():
        rows = await client.get_vote_turnout(sg_id, "3", region_sido)
        if not rows:
            continue

        elections_found += 1
        year = int(sg_id[:4])

        for row in rows:
            wiw_name = row.get("wiwName")
            sigungu = None if wiw_name in ("합계", None, "") else wiw_name

            try:
                tot_sunsu = int(row.get("totSunsu") or 0)
                tot_tusu = int(row.get("totTusu") or 0)
                ps_etc_tusu = int(row.get("psEtcTusu") or 0)  # 사전+거소
                turnout_rate = float(row.get("turnout") or 0)
            except (TypeError, ValueError):
                continue

            early_rate = round(ps_etc_tusu / tot_sunsu * 100, 2) if tot_sunsu > 0 else 0.0
            election_day_rate = round((tot_tusu - ps_etc_tusu) / tot_sunsu * 100, 2) if tot_sunsu > 0 else 0.0

            # voter_turnout: 시군별 총 투표율 (segment="합계", category="district")
            existing_vt = (await db_session.execute(
                sa_select(VoterTurnout).where(
                    VoterTurnout.election_year == year,
                    VoterTurnout.election_type == target_election_type,
                    VoterTurnout.region_sido == region_sido,
                    VoterTurnout.region_sigungu == sigungu,
                    VoterTurnout.category == "district",
                )
            )).scalar_one_or_none()

            if existing_vt:
                existing_vt.eligible_voters = tot_sunsu
                existing_vt.actual_voters = tot_tusu
                existing_vt.turnout_rate = turnout_rate
                skipped += 1
            else:
                db_session.add(VoterTurnout(
                    tenant_id=None,
                    election_number=num,
                    election_type=target_election_type,
                    election_year=year,
                    region_sido=region_sido,
                    region_sigungu=sigungu,
                    category="district",
                    segment="합계",
                    eligible_voters=tot_sunsu,
                    actual_voters=tot_tusu,
                    turnout_rate=turnout_rate,
                ))
                total_voter_rows += 1

            # early_voting: 사전투표 + 본투표
            existing_ev = (await db_session.execute(
                sa_select(EarlyVoting).where(
                    EarlyVoting.election_year == year,
                    EarlyVoting.election_type == target_election_type,
                    EarlyVoting.region_sido == region_sido,
                    EarlyVoting.region_sigungu == sigungu,
                )
            )).scalar_one_or_none()

            if existing_ev:
                existing_ev.eligible_voters = tot_sunsu
                existing_ev.early_voters = ps_etc_tusu
                existing_ev.early_rate = early_rate
                existing_ev.election_day_rate = election_day_rate
                existing_ev.total_rate = turnout_rate
            else:
                db_session.add(EarlyVoting(
                    tenant_id=None,
                    election_number=num,
                    election_type=target_election_type,
                    election_year=year,
                    region_sido=region_sido,
                    region_sigungu=sigungu,
                    eligible_voters=tot_sunsu,
                    early_voters=ps_etc_tusu,
                    early_rate=early_rate,
                    election_day_rate=election_day_rate,
                    total_rate=turnout_rate,
                ))
                total_early_rows += 1

    logger.info("nec_turnout_imported", region=region_sido,
                elections=elections_found, voter_rows=total_voter_rows, early_rows=total_early_rows)

    return {
        "elections_found": elections_found,
        "voter_turnout_rows": total_voter_rows,
        "early_voting_rows": total_early_rows,
        "updated": skipped,
        "region": region_sido,
    }
