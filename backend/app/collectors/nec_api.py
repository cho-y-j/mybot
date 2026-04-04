"""
ElectionPulse - 선관위 공공데이터 API 연동
역대 선거 결과, 투표율, 선거공약 자동 수집
"""
from urllib.parse import quote
from typing import Optional
import httpx
import structlog

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

    # ──────── 역대 지방선거 ──────────

    async def get_local_election_results(
        self, sg_id: str, sg_typecode: str,
        sd_name: str = None, wiw_name: str = None,
    ) -> list[dict]:
        """
        역대 지방선거 개표 결과.
        sg_id: 선거ID (예: "20220601" = 제8회 지방선거)
        sg_typecode: 선거종류코드
          1=시도지사, 2=구시군장, 3=시도의원, 4=구시군의원, 7=교육감
        sd_name: 시도명 (예: "충청북도")
        wiw_name: 구시군명 (예: "청주시")
        """
        params = {"sgId": sg_id, "sgTypecode": sg_typecode}
        if sd_name:
            params["sdName"] = sd_name
        if wiw_name:
            params["wiwName"] = wiw_name

        return await self._get(
            settings.NEC_LOCAL_ELECTION_URL,
            "getScgnLocElctExctSttnInqire",
            params,
        )

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


# 선거종류 코드 매핑
ELECTION_TYPE_CODES = {
    "governor": "1",       # 시도지사
    "mayor": "2",          # 구시군장
    "council_sido": "3",   # 시도의원
    "council": "4",        # 구시군의원
    "superintendent": "7", # 교육감
}

# 역대 지방선거 ID
LOCAL_ELECTION_IDS = {
    3: "19980604",
    4: "20020613",
    5: "20060531",
    6: "20100602",
    7: "20140604",
    8: "20220601",
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
    온보딩 시 자동 호출 — 해당 지역의 역대 선거 데이터를 수집하여 DB에 저장.
    """
    from app.elections.history_models import ElectionResult

    client = NECApiClient()
    type_code = ELECTION_TYPE_CODES.get(election_type, "7")

    total_imported = 0
    elections_found = 0

    for num, sg_id in LOCAL_ELECTION_IDS.items():
        results = await client.get_local_election_results(sg_id, type_code, region_sido)

        if not results:
            continue

        elections_found += 1

        for item in results:
            name = item.get("name") or item.get("jdName", "")
            party = item.get("jdName") or item.get("wiwName", "")
            votes = int(item.get("dugsu", 0) or 0)
            vote_rate = float(item.get("dugyul", 0) or 0)
            is_winner = item.get("whlr") == "당선" or str(item.get("giho", "")) == "1"

            db_session.add(ElectionResult(
                tenant_id=tenant_id,
                election_number=num,
                election_type=election_type,
                election_year=int(sg_id[:4]),
                region_sido=region_sido,
                region_sigungu=item.get("wiwName"),
                candidate_name=name,
                party=party,
                votes=votes,
                vote_rate=vote_rate,
                is_winner=is_winner,
            ))
            total_imported += 1

    logger.info("nec_history_imported", region=region_sido, type=election_type,
                elections=elections_found, records=total_imported)

    return {
        "elections_found": elections_found,
        "records_imported": total_imported,
        "region": region_sido,
        "type": election_type,
    }
