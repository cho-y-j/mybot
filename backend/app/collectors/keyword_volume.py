"""
ElectionPulse - 키워드 검색량 조회 (네이버 검색광고 API)
실제 월간 PC/모바일 검색수 + 연관 키워드 + 경쟁도
"""
import time
import hashlib
import hmac
import base64

import httpx
import structlog

from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()


class KeywordVolumeAPI:
    """네이버 검색광고 API — 키워드별 실제 월간 검색량."""

    BASE_URL = "https://api.searchad.naver.com"

    def __init__(self):
        self.api_key = settings.NAVER_SEARCHAD_API_KEY
        self.secret = settings.NAVER_SEARCHAD_SECRET
        self.customer_id = settings.NAVER_SEARCHAD_CUSTOMER_ID

    def _make_headers(self, method: str, uri: str) -> dict:
        ts = str(int(time.time() * 1000))
        message = f"{ts}.{method}.{uri}"
        sig = base64.b64encode(
            hmac.new(self.secret.encode(), message.encode(), hashlib.sha256).digest()
        ).decode()
        return {
            "X-Timestamp": ts,
            "X-API-KEY": self.api_key,
            "X-Customer": self.customer_id,
            "X-Signature": sig,
        }

    async def get_keyword_volumes(self, keywords: list[str]) -> list[dict]:
        """
        키워드별 월간 검색량 조회.
        Returns: [{"keyword": str, "pc": int, "mobile": int, "total": int, "competition": str}, ...]
        """
        if not self.api_key or not keywords:
            return []

        results = []
        async with httpx.AsyncClient() as client:
            # 한 번에 1개씩 조회 (관련 키워드도 함께 반환됨)
            for kw in keywords:
                try:
                    resp = await client.get(
                        f"{self.BASE_URL}/keywordstool",
                        params={"hintKeywords": kw, "showDetail": "1"},
                        headers=self._make_headers("GET", "/keywordstool"),
                        timeout=10,
                    )
                    if resp.status_code != 200:
                        continue

                    for item in resp.json().get("keywordList", []):
                        pc = self._parse_volume(item.get("monthlyPcQcCnt", 0))
                        mb = self._parse_volume(item.get("monthlyMobileQcCnt", 0))
                        results.append({
                            "keyword": item["relKeyword"],
                            "pc": pc,
                            "mobile": mb,
                            "total": pc + mb,
                            "competition": item.get("compIdx", ""),
                            "avg_pc_ctr": item.get("monthlyAvePcCtr", 0),
                            "avg_mobile_ctr": item.get("monthlyAveMobileCtr", 0),
                            "hint": kw,  # 어떤 키워드로 검색했는지
                        })
                except Exception as e:
                    logger.error("keyword_volume_error", keyword=kw, error=str(e))

        # 중복 제거 (같은 키워드가 여러 hint에서 나올 수 있음)
        seen = set()
        unique = []
        for r in sorted(results, key=lambda x: -x["total"]):
            if r["keyword"] not in seen:
                seen.add(r["keyword"])
                unique.append(r)

        return unique

    async def get_related_keywords(self, keyword: str, limit: int = 20) -> list[dict]:
        """
        연관 키워드 + 검색량 조회.
        메인 키워드를 넣으면 연관된 키워드와 각각의 검색량을 반환.
        """
        if not self.api_key:
            return []

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(
                    f"{self.BASE_URL}/keywordstool",
                    params={"hintKeywords": keyword, "showDetail": "1"},
                    headers=self._make_headers("GET", "/keywordstool"),
                    timeout=10,
                )
                if resp.status_code != 200:
                    return []

                results = []
                for item in resp.json().get("keywordList", [])[:limit]:
                    pc = self._parse_volume(item.get("monthlyPcQcCnt", 0))
                    mb = self._parse_volume(item.get("monthlyMobileQcCnt", 0))
                    results.append({
                        "keyword": item["relKeyword"],
                        "pc": pc,
                        "mobile": mb,
                        "total": pc + mb,
                        "competition": item.get("compIdx", ""),
                    })

                return sorted(results, key=lambda x: -x["total"])

            except Exception as e:
                logger.error("related_kw_error", error=str(e))
                return []

    @staticmethod
    def _parse_volume(val) -> int:
        if isinstance(val, int):
            return val
        if val == "< 10":
            return 5
        try:
            return int(str(val).replace(",", ""))
        except:
            return 0
