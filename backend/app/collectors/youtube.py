"""
ElectionPulse - YouTube Video Collector
유튜브 영상/댓글/숏츠 수집 엔진

수집 시점 게이트:
- publishedAfter (7일 기본)
- 조회수 최소 기준 (기본 50)
- homonym_filters (동명이인 차단)
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
import httpx
import structlog

from app.collectors.filters import apply_homonym_filter

logger = structlog.get_logger()

DEFAULT_RECENT_DAYS = 7
DEFAULT_MIN_VIEWS = 50


class YouTubeCollector:
    """YouTube Data API v3 기반 수집기.

    쿼터 로테이션: 1차 키 quotaExceeded → 2차 키 자동 fallback.
    일일 10,000 × N키 = 총 N만 unit 확보.
    """

    BASE_URL = "https://www.googleapis.com/youtube/v3"

    # 모든 인스턴스 공유 — 쿼터 소진 상태 (key_idx → datetime)
    # 프로세스 재시작 시 자동 초기화 (PT 자정 리셋과 불일치해도 다음 호출에서 재시도)
    _exhausted_at: dict[int, datetime] = {}

    def __init__(self, api_key: str = "", api_key_2: str = ""):
        # 빈 키는 제외
        self.keys: list[str] = [k for k in [api_key, api_key_2] if k]
        self.active_idx: int = 0
        # 과거 소진 이후 12시간 지나면 자동 재시도 (PT 자정 기준 리셋)
        self._retry_after_hours = 12

    @property
    def api_key(self) -> str:
        """현재 활성 키. 기존 호출 호환을 위해 property 유지."""
        if not self.keys:
            return ""
        self._maybe_reset_exhausted()
        # active_idx 가 소진 상태면 다른 키 찾기
        if self.active_idx in self._exhausted_at:
            for i in range(len(self.keys)):
                if i not in self._exhausted_at:
                    self.active_idx = i
                    break
        return self.keys[self.active_idx] if self.active_idx < len(self.keys) else ""

    def _maybe_reset_exhausted(self) -> None:
        """_exhausted_at 에 기록된 항목 중 12시간 지난 것 해제 (쿼터 복구)."""
        if not self._exhausted_at:
            return
        now = datetime.now(timezone.utc)
        stale = [k for k, t in self._exhausted_at.items() if (now - t).total_seconds() > self._retry_after_hours * 3600]
        for k in stale:
            del self._exhausted_at[k]
            logger.info("youtube_key_retry", key_idx=k)

    def _mark_exhausted_and_rotate(self) -> bool:
        """현재 키를 소진으로 마킹하고 다음 키로 전환. 남은 키 없으면 False."""
        cur = self.active_idx
        self._exhausted_at[cur] = datetime.now(timezone.utc)
        logger.warning("youtube_key_quota_exceeded", key_idx=cur, total_keys=len(self.keys))
        for i in range(len(self.keys)):
            if i != cur and i not in self._exhausted_at:
                self.active_idx = i
                logger.info("youtube_key_rotated", from_idx=cur, to_idx=i)
                return True
        logger.error("youtube_all_keys_exhausted", total_keys=len(self.keys))
        return False

    def _is_quota_exceeded(self, resp: httpx.Response) -> bool:
        """quotaExceeded 에러 감지."""
        if resp.status_code != 403:
            return False
        try:
            body = resp.json()
            errors = (body.get("error") or {}).get("errors") or []
            return any(e.get("reason") in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded") for e in errors)
        except Exception:
            return "quotaExceeded" in resp.text or "dailyLimitExceeded" in resp.text

    async def search_videos(
        self,
        keyword: str,
        max_results: int = 10,
        order: str = "date",
        region: str = "KR",
        video_duration: str = None,
        recent_days: int = DEFAULT_RECENT_DAYS,
        min_views: int = DEFAULT_MIN_VIEWS,
        homonym_filters: dict | None = None,
    ) -> list[dict]:
        """
        유튜브 영상 검색.
        video_duration: None(전체) | "short"(숏츠/4분 이하) | "medium" | "long"
        recent_days: publishedAfter 컷오프 (기본 7일). 0이면 시간 필터 없음.
        min_views: 조회수 최소치 (기본 50). 0이면 품질 필터 없음.
        homonym_filters: {exclude, require_any, require_name}
        Returns: [{"video_id", "title", "channel", "description", "published_at",
                   "thumbnail", "is_short"}, ...]
        """
        if not self.api_key:
            logger.warning("youtube_no_api_key")
            return []

        params = {
            "part": "snippet",
            "q": keyword,
            "type": "video",
            "maxResults": max_results,
            "order": order,
            "regionCode": region,
            "relevanceLanguage": "ko",
            "key": self.api_key,
        }

        if recent_days > 0:
            published_after = (datetime.now(timezone.utc) - timedelta(days=recent_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
            params["publishedAfter"] = published_after

        if video_duration:
            params["videoDuration"] = video_duration

        async with httpx.AsyncClient() as client:
            try:
                # 쿼터 로테이션: 1차 quotaExceeded → 2차 키로 자동 재시도
                resp = None
                for _attempt in range(len(self.keys) or 1):
                    params["key"] = self.api_key  # 현재 활성 키
                    resp = await client.get(
                        f"{self.BASE_URL}/search",
                        params=params,
                        timeout=15,
                    )
                    if self._is_quota_exceeded(resp):
                        if self._mark_exhausted_and_rotate():
                            continue  # 다른 키로 재시도
                        # 모든 키 소진
                        raise RuntimeError("youtube_all_keys_exhausted")
                    break  # 성공
                resp.raise_for_status()
                data = resp.json()

                videos = []
                video_ids = []

                for item in data.get("items", []):
                    vid = item["id"].get("videoId", "")
                    snippet = item.get("snippet", {})
                    videos.append({
                        "video_id": vid,
                        "title": snippet.get("title", ""),
                        "channel": snippet.get("channelTitle", ""),
                        "description": snippet.get("description", "")[:300],
                        "published_at": snippet.get("publishedAt"),
                        "thumbnail": snippet.get("thumbnails", {}).get("medium", {}).get("url"),
                        "is_short": video_duration == "short",
                    })
                    video_ids.append(vid)

                # 조회수/좋아요 등 통계 가져오기
                if video_ids:
                    stats_and_details = await self._get_video_details(client, video_ids)
                    for v in videos:
                        info = stats_and_details.get(v["video_id"], {})
                        s = info.get("statistics", {})
                        v["views"] = int(s.get("viewCount", 0))
                        v["likes"] = int(s.get("likeCount", 0))
                        v["comments_count"] = int(s.get("commentCount", 0))
                        # Shorts 자동 감지: duration 기반
                        duration = info.get("duration", "")
                        if not v["is_short"] and duration:
                            v["is_short"] = self._is_short_duration(duration)

                before_quality = len(videos)
                if min_views > 0:
                    videos = [v for v in videos if v.get("views", 0) >= min_views]

                before_homonym = len(videos)
                if homonym_filters:
                    videos = apply_homonym_filter(
                        videos, homonym_filters,
                        text_fields=("title", "description", "channel"),
                    )

                logger.info(
                    "youtube_search",
                    keyword=keyword, count=len(videos),
                    raw=before_quality, after_views=before_homonym,
                    min_views=min_views, recent_days=recent_days,
                    duration_filter=video_duration,
                )
                return videos

            except Exception as e:
                logger.error("youtube_search_error", keyword=keyword, error=str(e))
                return []

    async def search_shorts(
        self,
        keyword: str,
        max_results: int = 10,
        order: str = "date",
    ) -> list[dict]:
        """
        DEPRECATED: search_videos 결과에서 is_short=True 를 그대로 사용하세요.
        쿼터 절감을 위해 별도 API 호출 안 하고 빈 배열 반환 (호환성 유지).

        Why: search.list 는 100 unit/회. 일반/쇼츠 따로 부르면 2배.
        search_videos 는 이미 duration 기반으로 is_short 를 자동 마킹함.
        """
        logger.info("youtube_shorts_deprecated", note="use search_videos + is_short filter")
        return []

    async def _get_video_details(
        self, client: httpx.AsyncClient, video_ids: list[str]
    ) -> dict:
        """영상별 통계 + contentDetails(duration) 조회."""
        params = {
            "part": "statistics,contentDetails",
            "id": ",".join(video_ids),
        }
        try:
            resp = None
            for _attempt in range(len(self.keys) or 1):
                params["key"] = self.api_key
                resp = await client.get(
                    f"{self.BASE_URL}/videos",
                    params=params,
                    timeout=15,
                )
                if self._is_quota_exceeded(resp):
                    if self._mark_exhausted_and_rotate():
                        continue
                    raise RuntimeError("youtube_all_keys_exhausted")
                break
            resp.raise_for_status()
            data = resp.json()

            result = {}
            for item in data.get("items", []):
                result[item["id"]] = {
                    "statistics": item.get("statistics", {}),
                    "duration": item.get("contentDetails", {}).get("duration", ""),
                }
            return result

        except Exception as e:
            logger.error("youtube_details_error", error=str(e))
            return {}

    async def _get_video_stats(
        self, client: httpx.AsyncClient, video_ids: list[str]
    ) -> dict:
        """영상별 통계 조회 (하위 호환용)."""
        details = await self._get_video_details(client, video_ids)
        return {vid: info.get("statistics", {}) for vid, info in details.items()}

    @staticmethod
    def _is_short_duration(iso_duration: str) -> bool:
        """ISO 8601 duration이 60초 이하인지 판별 (숏츠 기준)."""
        import re
        # PT1M30S, PT45S, PT2M 등 파싱
        m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso_duration)
        if not m:
            return False
        hours = int(m.group(1) or 0)
        minutes = int(m.group(2) or 0)
        seconds = int(m.group(3) or 0)
        total_seconds = hours * 3600 + minutes * 60 + seconds
        return total_seconds <= 60

    async def get_video_comments(
        self, video_id: str, max_results: int = 20
    ) -> list[dict]:
        """영상 댓글 수집."""
        if not self.api_key:
            return []

        params = {
            "part": "snippet",
            "videoId": video_id,
            "maxResults": max_results,
            "order": "relevance",
        }

        async with httpx.AsyncClient() as client:
            try:
                resp = None
                for _attempt in range(len(self.keys) or 1):
                    params["key"] = self.api_key
                    resp = await client.get(
                        f"{self.BASE_URL}/commentThreads",
                        params=params,
                        timeout=15,
                    )
                    if self._is_quota_exceeded(resp):
                        if self._mark_exhausted_and_rotate():
                            continue
                        raise RuntimeError("youtube_all_keys_exhausted")
                    break
                resp.raise_for_status()
                data = resp.json()

                comments = []
                for item in data.get("items", []):
                    snippet = item["snippet"]["topLevelComment"]["snippet"]
                    comments.append({
                        "author": snippet.get("authorDisplayName", ""),
                        "text": snippet.get("textDisplay", ""),
                        "likes": snippet.get("likeCount", 0),
                        "published_at": snippet.get("publishedAt"),
                    })
                return comments

            except Exception as e:
                logger.error("youtube_comments_error", video_id=video_id, error=str(e))
                return []
