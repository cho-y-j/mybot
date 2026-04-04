"""
ElectionPulse - Search Trend Collector
네이버 DataLab + 검색광고 API 기반 검색 트렌드 수집
"""
import hashlib
import hmac
import time
from typing import Optional

import httpx
import structlog

logger = structlog.get_logger()


class NaverTrendCollector:
    """네이버 DataLab API 기반 트렌드 수집기."""

    DATALAB_URL = "https://openapi.naver.com/v1/datalab/search"
    SEARCHAD_URL = "https://api.searchad.naver.com"

    def __init__(
        self,
        client_id: str = "",
        client_secret: str = "",
        searchad_api_key: str = "",
        searchad_secret: str = "",
        searchad_customer_id: str = "",
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.searchad_api_key = searchad_api_key
        self.searchad_secret = searchad_secret
        self.searchad_customer_id = searchad_customer_id

    async def get_relative_trend(
        self,
        keywords: list[str],
        start_date: str,
        end_date: str,
        time_unit: str = "date",
    ) -> dict:
        """
        네이버 DataLab 상대 검색량 추이.
        keywords: ["김진균", "윤건영", "김성근"]
        Returns: {"김진균": [{"date": "2026-03-01", "ratio": 45.2}, ...], ...}
        """
        if not self.client_id:
            logger.warning("naver_datalab_no_credentials")
            return {}

        body = {
            "startDate": start_date,
            "endDate": end_date,
            "timeUnit": time_unit,
            "keywordGroups": [
                {"groupName": kw, "keywords": [kw]}
                for kw in keywords
            ],
        }
        headers = {
            "X-Naver-Client-Id": self.client_id,
            "X-Naver-Client-Secret": self.client_secret,
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    self.DATALAB_URL,
                    json=body,
                    headers=headers,
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()

                result = {}
                for group in data.get("results", []):
                    name = group["title"]
                    result[name] = [
                        {"date": d["period"], "ratio": d["ratio"]}
                        for d in group.get("data", [])
                    ]
                return result

            except Exception as e:
                logger.error("naver_datalab_error", error=str(e))
                return {}

    async def get_search_volume(self, keywords: list[str]) -> dict:
        """
        네이버 검색광고 API — 키워드별 월간 검색량.
        Returns: {"김진균": {"monthly_pc": 1200, "monthly_mobile": 3400}, ...}
        """
        if not self.searchad_api_key:
            return {}

        timestamp = str(int(time.time() * 1000))
        path = "/keywordstool"
        signature = self._generate_signature(timestamp, "GET", path)

        headers = {
            "X-Timestamp": timestamp,
            "X-API-KEY": self.searchad_api_key,
            "X-Customer": self.searchad_customer_id,
            "X-Signature": signature,
        }
        params = {
            "hintKeywords": ",".join(keywords),
            "showDetail": "1",
        }

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(
                    f"{self.SEARCHAD_URL}{path}",
                    params=params,
                    headers=headers,
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()

                result = {}
                for item in data.get("keywordList", []):
                    kw = item.get("relKeyword", "")
                    if kw in keywords:
                        result[kw] = {
                            "monthly_pc": item.get("monthlyPcQcCnt", 0),
                            "monthly_mobile": item.get("monthlyMobileQcCnt", 0),
                            "competition": item.get("compIdx", ""),
                        }
                return result

            except Exception as e:
                logger.error("searchad_error", error=str(e))
                return {}

    def _generate_signature(self, timestamp: str, method: str, path: str) -> str:
        """네이버 검색광고 API 서명 생성."""
        message = f"{timestamp}.{method}.{path}"
        sign = hmac.new(
            self.searchad_secret.encode("utf-8"),
            message.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return sign
