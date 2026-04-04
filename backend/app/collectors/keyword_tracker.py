"""
ElectionPulse - 실시간 키워드/검색 트렌드 수집기
네이버 DataLab API 기반 — 후보별 + 이슈별 검색량 추적
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
import json

import httpx
import structlog

from app.config import get_settings
from app.elections.korea_data import ELECTION_ISSUES

logger = structlog.get_logger()
settings = get_settings()


class KeywordTracker:
    """네이버 DataLab 기반 실시간 키워드 추적."""

    DATALAB_URL = "https://openapi.naver.com/v1/datalab/search"

    def __init__(self):
        self.client_id = settings.NAVER_CLIENT_ID
        self.client_secret = settings.NAVER_CLIENT_SECRET

    async def get_candidate_trends(
        self, candidates: list[str], days: int = 30,
    ) -> dict:
        """
        후보별 검색량 추이.
        Returns: {"김진균": [{"date": "2026-03-01", "ratio": 5.2}, ...], ...}
        """
        if not self.client_id or len(candidates) == 0:
            return {}

        now = datetime.now()
        body = {
            "startDate": (now - timedelta(days=days)).strftime("%Y-%m-%d"),
            "endDate": now.strftime("%Y-%m-%d"),
            "timeUnit": "date",
            "keywordGroups": [
                {"groupName": name, "keywords": [name]}
                for name in candidates[:5]  # DataLab 최대 5그룹
            ],
        }

        return await self._call_datalab(body)

    async def get_issue_trends(
        self, election_type: str, region_short: str = "", days: int = 30,
    ) -> dict:
        """
        선거 유형별 이슈 키워드 검색량 추이.
        교육감이면 급식/돌봄/학폭/교권 등, 시장이면 교통/개발/복지 등.
        """
        issues = ELECTION_ISSUES.get(election_type, {}).get("issues", [])
        if not issues:
            return {}

        # 상위 5개 이슈 키워드로 그룹 구성
        top_issues = issues[:5]
        now = datetime.now()

        body = {
            "startDate": (now - timedelta(days=days)).strftime("%Y-%m-%d"),
            "endDate": now.strftime("%Y-%m-%d"),
            "timeUnit": "date",
            "keywordGroups": [
                {"groupName": issue, "keywords": [issue, f"{region_short} {issue}"] if region_short else [issue]}
                for issue in top_issues
            ],
        }

        return await self._call_datalab(body)

    async def get_custom_trends(
        self, keyword_groups: list[dict], days: int = 30,
    ) -> dict:
        """
        커스텀 키워드 그룹 검색량.
        keyword_groups: [{"name": "급식", "keywords": ["학교급식", "무상급식"]}, ...]
        """
        now = datetime.now()
        body = {
            "startDate": (now - timedelta(days=days)).strftime("%Y-%m-%d"),
            "endDate": now.strftime("%Y-%m-%d"),
            "timeUnit": "date",
            "keywordGroups": [
                {"groupName": g["name"], "keywords": g["keywords"]}
                for g in keyword_groups[:5]
            ],
        }

        return await self._call_datalab(body)

    async def _call_datalab(self, body: dict) -> dict:
        """DataLab API 호출."""
        headers = {
            "X-Naver-Client-Id": self.client_id,
            "X-Naver-Client-Secret": self.client_secret,
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    self.DATALAB_URL, json=body, headers=headers, timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()

                result = {}
                for group in data.get("results", []):
                    name = group["title"]
                    points = group.get("data", [])
                    result[name] = {
                        "data": [{"date": d["period"], "ratio": d["ratio"]} for d in points],
                        "latest": points[-1]["ratio"] if points else 0,
                        "avg_7d": sum(d["ratio"] for d in points[-7:]) / min(7, len(points)) if points else 0,
                        "avg_30d": sum(d["ratio"] for d in points) / len(points) if points else 0,
                        "trend": self._calc_trend(points),
                    }

                return result

            except Exception as e:
                logger.error("datalab_error", error=str(e))
                return {}

    @staticmethod
    def _calc_trend(points: list[dict]) -> str:
        """최근 7일 vs 이전 7일 비교 → 상승/하락/유지."""
        if len(points) < 14:
            return "insufficient"
        recent = sum(d["ratio"] for d in points[-7:]) / 7
        previous = sum(d["ratio"] for d in points[-14:-7]) / 7
        if previous == 0:
            return "new"
        change = (recent - previous) / previous * 100
        if change > 10:
            return "rising"
        elif change < -10:
            return "falling"
        return "stable"


async def collect_and_store_trends(
    db_session, tenant_id: str, election_id: str,
    candidates: list[str], election_type: str, region_short: str,
):
    """
    검색 트렌드 수집 → DB 저장.
    스케줄에서 자동 호출됨.
    """
    from sqlalchemy import text
    import uuid

    tracker = KeywordTracker()

    # 1. 후보별 트렌드
    cand_trends = await tracker.get_candidate_trends(candidates)
    stored = 0

    for name, trend_data in cand_trends.items():
        db_session.execute(text("""
            INSERT INTO search_trends (id, tenant_id, election_id, keyword, platform,
                relative_volume, search_volume, checked_at)
            VALUES (:id, :tid, :eid, :kw, 'naver_datalab', :vol, :svol, NOW())
        """), {
            "id": str(uuid.uuid4()), "tid": tenant_id, "eid": election_id,
            "kw": name, "vol": trend_data["latest"],
            "svol": int(trend_data["avg_7d"] * 100),
        })
        stored += 1

    # 2. 이슈 키워드 트렌드
    issue_trends = await tracker.get_issue_trends(election_type, region_short)

    for issue, trend_data in issue_trends.items():
        db_session.execute(text("""
            INSERT INTO search_trends (id, tenant_id, election_id, keyword, platform,
                relative_volume, search_volume, checked_at)
            VALUES (:id, :tid, :eid, :kw, 'naver_datalab_issue', :vol, :svol, NOW())
        """), {
            "id": str(uuid.uuid4()), "tid": tenant_id, "eid": election_id,
            "kw": issue, "vol": trend_data["latest"],
            "svol": int(trend_data["avg_7d"] * 100),
        })
        stored += 1

    logger.info("trends_stored", tenant_id=tenant_id, count=stored)
    return {"stored": stored, "candidates": len(cand_trends), "issues": len(issue_trends)}
