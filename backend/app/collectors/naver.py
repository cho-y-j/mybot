"""
ElectionPulse - Naver News/Blog/Cafe Collector
기존 프로토타입의 검증된 크롤링 로직을 async로 포팅
"""
import asyncio
import os
import re
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote, urlparse

import httpx
from bs4 import BeautifulSoup
import structlog

logger = structlog.get_logger()

# ──────────────── Redis 전역 Rate Limit ──────────────────────────
# 모든 Celery worker가 공유하는 초당 버킷. 네이버 공식 한도: 초당 10회 → 안전하게 8회.
_NAVER_RPS = 8
_NAVER_DAILY_SOFT_LIMIT = 25000  # 단일 앱 기본 한도 (2차 키 포함 시 50,000)
_redis_client = None


def _get_redis():
    global _redis_client
    if _redis_client is None:
        try:
            import redis
            _redis_client = redis.Redis.from_url(
                os.getenv("REDIS_URL", "redis://ep_redis:6379"),
                decode_responses=True,
                socket_timeout=2,
            )
            _redis_client.ping()
        except Exception as e:
            logger.warning("naver_redis_unavailable", error=str(e))
            _redis_client = False  # 실패 sentinel
    return _redis_client if _redis_client is not False else None


async def _throttle_naver():
    """Redis 기반 초당 토큰 버킷. 모든 워커 공유."""
    r = _get_redis()
    if r is None:
        # Redis 없으면 프로세스 로컬 fallback
        await asyncio.sleep(1.0 / _NAVER_RPS)
        return
    for _ in range(100):  # 최대 ~1.5초 대기
        now_sec = int(time.time())
        key = f"naver:rate:{now_sec}"
        try:
            pipe = r.pipeline()
            pipe.incr(key)
            pipe.expire(key, 3)
            count, _expire_ok = pipe.execute()
            if count <= _NAVER_RPS:
                return
        except Exception as e:
            logger.warning("naver_throttle_redis_err", error=str(e))
            return
        # 다음 초까지 대기
        wait_ms = 1000 - (int(time.time() * 1000) % 1000) + 20
        await asyncio.sleep(wait_ms / 1000)


def _record_daily_usage() -> int:
    """일일 사용량 증가 + 80%/100% 경보. 반환: 오늘 누적 호출 수."""
    r = _get_redis()
    if r is None:
        return 0
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    key = f"naver:usage:{today}"
    try:
        count = r.incr(key)
        if count == 1:
            r.expire(key, 3 * 86400)
        # 2차 키 있을 때는 50000, 없으면 25000
        limit = _NAVER_DAILY_SOFT_LIMIT * 2
        if count == int(limit * 0.8):
            logger.warning("naver_usage_80pct", count=count, limit=limit)
        elif count == limit:
            logger.error("naver_usage_exceeded", count=count, limit=limit)
        return int(count)
    except Exception:
        return 0


async def _get_with_retry(client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
    """스크래핑 전용: throttle + 429 재시도. API 호출은 NaverCollector._api_get 사용."""
    await _throttle_naver()
    _record_daily_usage()
    resp = await client.get(url, **kwargs)
    if resp.status_code == 429:
        logger.warning("naver_429_retry", url=url)
        await asyncio.sleep(2.0)
        await _throttle_naver()
        resp = await client.get(url, **kwargs)
    return resp

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.3",
}

# 네이버 뉴스 링크 CSS 클래스 (변경 빈번 → 여러 패턴 지원)
NAVER_NEWS_LINK_CLASSES = [
    "qWflZiHeQFq9pBzWximH",
    "news_tit",
    "api_txt_lines",
    "fender-ui",
    "djJH4NJWd85iOh4w2PWK",
]


class NaverCollector:
    """네이버 뉴스/블로그/카페 수집기 (API + 스크래핑 듀얼모드).

    쿼터 로테이션: 1차 키 429/errorCode SE06 → 2차 키 자동 전환.
    일일 25,000 × N키 = 총 N×2.5만회 확보.
    """

    # 모든 인스턴스 공유 — 소진 상태 (key_idx → datetime)
    _exhausted_at: dict[int, datetime] = {}

    def __init__(
        self,
        client_id: str = "",
        client_secret: str = "",
        client_id_2: str = "",
        client_secret_2: str = "",
    ):
        creds = [(client_id, client_secret), (client_id_2, client_secret_2)]
        self.keys: list[tuple[str, str]] = [c for c in creds if c[0] and c[1]]
        self.active_idx: int = 0
        self._retry_after_hours = 12

    def _maybe_reset_exhausted(self) -> None:
        if not self._exhausted_at:
            return
        now = datetime.now(timezone.utc)
        stale = [k for k, t in self._exhausted_at.items()
                 if (now - t).total_seconds() > self._retry_after_hours * 3600]
        for k in stale:
            del self._exhausted_at[k]
            logger.info("naver_key_retry", key_idx=k)

    def _current_creds(self) -> tuple[str, str] | None:
        if not self.keys:
            return None
        self._maybe_reset_exhausted()
        if self.active_idx in self._exhausted_at:
            for i in range(len(self.keys)):
                if i not in self._exhausted_at:
                    self.active_idx = i
                    break
        return self.keys[self.active_idx] if self.active_idx < len(self.keys) else None

    @property
    def client_id(self) -> str:
        c = self._current_creds()
        return c[0] if c else ""

    @property
    def client_secret(self) -> str:
        c = self._current_creds()
        return c[1] if c else ""

    def _mark_exhausted_and_rotate(self) -> bool:
        cur = self.active_idx
        self._exhausted_at[cur] = datetime.now(timezone.utc)
        logger.warning("naver_key_quota_exceeded", key_idx=cur, total_keys=len(self.keys))
        for i in range(len(self.keys)):
            if i != cur and i not in self._exhausted_at:
                self.active_idx = i
                logger.info("naver_key_rotated", from_idx=cur, to_idx=i)
                return True
        logger.error("naver_all_keys_exhausted", total_keys=len(self.keys))
        return False

    def _is_rate_limited(self, resp: httpx.Response) -> bool:
        """429 Too Many Requests + 네이버 errorCode (SE06 일일 초과 / SE09 서버 부하)."""
        if resp.status_code == 429:
            return True
        if resp.status_code in (400, 403, 500):
            try:
                body = resp.json()
                code = (body.get("errorCode") or "").upper()
                if code in ("SE06", "SE09", "SE04", "QUOTA_EXCEEDED"):
                    return True
            except Exception:
                pass
        return False

    async def _api_get(self, url: str, params: dict) -> Optional[dict]:
        """API 호출 공통 진입점: throttle + 키 로테이션 + 429 재시도.
        반환: 파싱된 JSON dict 또는 None(모든 키 소진/실패)."""
        if not self.keys:
            return None
        async with httpx.AsyncClient() as client:
            last_resp: httpx.Response | None = None
            for _ in range(max(1, len(self.keys))):
                cur = self._current_creds()
                if not cur:
                    break
                headers = {
                    "X-Naver-Client-Id": cur[0],
                    "X-Naver-Client-Secret": cur[1],
                }
                await _throttle_naver()
                _record_daily_usage()
                last_resp = await client.get(url, params=params, headers=headers, timeout=15)
                if self._is_rate_limited(last_resp):
                    if self._mark_exhausted_and_rotate():
                        continue
                    return None
                break
            if last_resp is None:
                return None
            try:
                last_resp.raise_for_status()
                return last_resp.json()
            except Exception as e:
                logger.error("naver_api_error", url=url, status=getattr(last_resp, "status_code", 0), error=str(e))
                return None

    # ──────────────── NEWS ──────────────────────────────────────

    async def search_news(
        self, keyword: str, display: int = 20,
        homonym_filters: dict = None,
    ) -> list[dict]:
        """
        네이버 뉴스 수집 (API 우선 → 스크래핑 폴백).
        homonym_filters: {"exclude": ["야구", ...], "require_any": ["교육", ...]}
        """
        if self.client_id:
            articles = await self._api_news(keyword, display)
        else:
            articles = await self._scrape_news(keyword, display)

        # 동명이인 필터 적용
        if homonym_filters:
            articles = self._apply_homonym_filter(articles, homonym_filters)

        return articles

    async def _api_news(self, keyword: str, display: int) -> list[dict]:
        """네이버 뉴스 검색 API (키 로테이션 + 전역 throttle)."""
        url = "https://openapi.naver.com/v1/search/news.json"
        params = {"query": keyword, "display": display, "sort": "date"}
        data = await self._api_get(url, params)
        if data is None:
            logger.info("naver_news_api_fallback_scrape", keyword=keyword)
            return await self._scrape_news(keyword, display)
        articles = []
        for item in data.get("items", []):
            href = item.get("originallink") or item.get("link", "")
            articles.append({
                "title": self._clean_html(item.get("title", "")),
                "url": href,
                "source": self._extract_source(href),
                "description": self._clean_html(item.get("description", "")),
                "pub_date": item.get("pubDate"),
                "platform": "naver",
            })
        logger.info("naver_news_api", keyword=keyword, count=len(articles), key_idx=self.active_idx)
        return articles

    async def _scrape_news(self, keyword: str, count: int = 20) -> list[dict]:
        """네이버 뉴스 웹 스크래핑 (API 실패 시 폴백)."""
        encoded = quote(keyword)
        url = f"https://search.naver.com/search.naver?where=news&query={encoded}&sort=1"

        async with httpx.AsyncClient() as client:
            try:
                resp = await _get_with_retry(client, url, headers=HEADERS, timeout=15)
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "lxml")

                articles = []
                # 다양한 CSS 클래스 패턴 시도
                for a_tag in soup.find_all("a", href=True):
                    href = a_tag.get("href", "")
                    title = a_tag.get_text(strip=True)

                    if len(title) < 15:
                        continue
                    if "naver.com/search" in href:
                        continue
                    # 네이버 UI/광고/쓰레기 필터
                    GARBAGE_PATTERNS = [
                        "언론사 선정", "네이버 메인에서", "구독하세요", "관련뉴스",
                        "멤버십", "무료배송", "스토어", "클립 챌린지", "취향을 남겨",
                        "홈리빙", "인기 스토어", "24시간 센터", "문제 발생시",
                        "컬리를", "쇼핑", "할인", "쿠폰", "적립",
                    ]
                    if any(x in title for x in GARBAGE_PATTERNS):
                        continue
                    # naver 내부 링크 차단
                    if any(x in href for x in [
                        "naver.com/my", "naver.com/notify", "naver.com/help",
                        "shopping.naver", "smartstore.naver", "campaign.naver",
                        "naver.com/nid", "login.naver",
                    ]):
                        continue

                    # 뉴스 링크 판별 (엄격 모드)
                    cls = " ".join(a_tag.get("class", []))
                    is_news = any(c in cls for c in NAVER_NEWS_LINK_CLASSES)
                    # .com만으로는 부족 — 뉴스 도메인 패턴 필요
                    if not is_news:
                        is_news = any(x in href for x in [
                            "news", "article", ".co.kr/", "journalist",
                            "daejonilbo", "newsis", "nocutnews", "breaknews",
                        ])
                    # 네이버 자체 서비스 제외
                    if any(x in href for x in ["shopping", "smartstore", "blog.naver", "cafe.naver"]):
                        is_news = False

                    if not is_news:
                        continue

                    # 소스 추출
                    source = self._extract_source(href)

                    # 설명 추출 (부모 요소에서)
                    desc = ""
                    parent = a_tag.find_parent(["li", "div"])
                    if parent:
                        for desc_cls in ["api_txt_lines", "dsc_txt", "news_dsc", "total_dsc"]:
                            desc_el = parent.find(["div", "span"], class_=lambda c: c and desc_cls in str(c))
                            if desc_el:
                                desc = desc_el.get_text(strip=True)[:300]
                                break

                    # 날짜 추출 시도 (부모 요소에서)
                    pub_date_str = None
                    if parent:
                        for date_cls in ["info_group_inner", "sub_txt", "news_info", "dsc_sub"]:
                            date_el = parent.find(["span", "div", "p"], class_=lambda c: c and date_cls in str(c))
                            if date_el:
                                date_text = date_el.get_text(strip=True)
                                # "2026.04.05." 또는 "1시간 전" 등
                                import re
                                date_match = re.search(r'(\d{4})\.(\d{2})\.(\d{2})', date_text)
                                if date_match:
                                    pub_date_str = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"
                                break

                    articles.append({
                        "title": title,
                        "url": href,
                        "source": source,
                        "description": desc,
                        "pub_date": pub_date_str,
                        "platform": "naver",
                    })

                # 중복 제거
                articles = self._deduplicate(articles)[:count]
                logger.info("naver_news_scraped", keyword=keyword, count=len(articles))
                return articles
            except Exception as e:
                logger.error("naver_news_scrape_error", keyword=keyword, error=str(e))
                return []

    # ──────────────── BLOG/CAFE ────────────────────────────────

    async def search_blog(self, keyword: str, display: int = 10) -> list[dict]:
        """네이버 블로그 검색."""
        if self.client_id:
            return await self._api_search("blog", keyword, display)
        return await self._scrape_community("blog", keyword, display)

    async def search_cafe(self, keyword: str, display: int = 10) -> list[dict]:
        """네이버 카페 검색."""
        if self.client_id:
            return await self._api_search("cafearticle", keyword, display)
        return await self._scrape_community("article", keyword, display)

    async def _api_search(self, search_type: str, keyword: str, display: int) -> list[dict]:
        """네이버 검색 API (blog/cafearticle) - 키 로테이션 + 전역 throttle."""
        url = f"https://openapi.naver.com/v1/search/{search_type}.json"
        params = {"query": keyword, "display": display, "sort": "date"}
        data = await self._api_get(url, params)
        if data is None:
            return []
        posts = []
        for item in data.get("items", []):
            posts.append({
                "title": self._clean_html(item.get("title", "")),
                "url": item.get("link", ""),
                "author": item.get("bloggername") or item.get("cafename", ""),
                "description": self._clean_html(item.get("description", ""))[:200],
                "pub_date": item.get("postdate"),
                "platform": "naver_blog" if search_type == "blog" else "naver_cafe",
            })
        return posts

    async def _scrape_community(self, where: str, keyword: str, count: int) -> list[dict]:
        """네이버 블로그/카페 웹 스크래핑."""
        encoded = quote(keyword)
        url = f"https://search.naver.com/search.naver?where={where}&query={encoded}&sort=1"

        async with httpx.AsyncClient() as client:
            try:
                resp = await _get_with_retry(client, url, headers=HEADERS, timeout=15)
                soup = BeautifulSoup(resp.text, "lxml")
                posts = []

                for a_tag in soup.find_all("a", href=True):
                    href = a_tag.get("href", "")
                    title = a_tag.get_text(strip=True)
                    if len(title) < 10:
                        continue

                    cls = " ".join(a_tag.get("class", []))
                    is_link = any(c in cls for c in NAVER_NEWS_LINK_CLASSES + ["title"])
                    is_link = is_link or any(x in href for x in ["blog.naver", "cafe.naver", "tistory"])

                    if not is_link:
                        continue

                    platform = "naver_blog"
                    if "cafe" in href:
                        platform = "naver_cafe"
                    elif "tistory" in href:
                        platform = "tistory"

                    # 설명 + 날짜 추출
                    desc = ""
                    pub_date = None
                    parent = a_tag.find_parent(["li", "div"])
                    if parent:
                        for desc_cls in ["api_txt_lines", "dsc_txt", "txt_area"]:
                            desc_el = parent.find("div", class_=lambda c: c and desc_cls in str(c))
                            if desc_el:
                                desc = desc_el.get_text(strip=True)[:200]
                                break
                        # 날짜 추출 (네이버 검색 결과 CSS에서)
                        from app.collectors.filters import extract_naver_result_date
                        pub_date = extract_naver_result_date(parent)

                    posts.append({
                        "title": title, "url": href, "author": "",
                        "description": desc, "pub_date": pub_date, "platform": platform,
                    })

                return self._deduplicate(posts)[:count]
            except Exception as e:
                logger.error("naver_community_scrape_error", error=str(e))
                return []

    # ──────────────── HELPERS ──────────────────────────────────

    def _apply_homonym_filter(self, articles: list[dict], filters: dict) -> list[dict]:
        """동명이인 필터 적용.

        filters:
            exclude: list[str] — 이 단어가 본문에 있으면 무조건 차단 (산은캐피탈, 사외이사 등)
            require_any: list[str] — 이 중 하나라도 있어야 함 (정치/지역 컨텍스트 OR)
            require_name: list[str] — 후보 이름 변형 (이 중 하나라도 있어야 함, 강제)
        """
        exclude = filters.get("exclude", [])
        require_any = filters.get("require_any", [])
        require_name = filters.get("require_name", [])
        filtered = []
        excluded_count = 0
        no_require_count = 0
        no_name_count = 0

        for article in articles:
            text = f"{article['title']} {article.get('description', '')}"
            # 1. 동명이인 차단어
            if any(ex in text for ex in exclude):
                excluded_count += 1
                continue
            # 2. 후보 이름이 본문에 반드시 있어야 함 (네이버 API가 키워드 매칭 외 이상한 결과 반환할 때 차단)
            if require_name and not any(n in text for n in require_name):
                no_name_count += 1
                continue
            # 3. 정치/지역 컨텍스트 키워드 (OR)
            if require_any and not any(req in text for req in require_any):
                no_require_count += 1
                continue
            filtered.append(article)

        logger.info("homonym_filtered", before=len(articles), after=len(filtered),
                    excluded=excluded_count, no_name=no_name_count, no_context=no_require_count)
        return filtered

    @staticmethod
    def _deduplicate(items: list[dict]) -> list[dict]:
        """URL + 제목 앞 20자 기준 중복 제거."""
        seen_urls: set = set()
        seen_titles: set = set()
        unique = []
        for item in items:
            url = item.get("url", "")
            title_key = item.get("title", "")[:20]
            if url in seen_urls or title_key in seen_titles:
                continue
            seen_urls.add(url)
            seen_titles.add(title_key)
            unique.append(item)
        return unique

    @staticmethod
    def _clean_html(text: str) -> str:
        return re.sub(r"<[^>]+>", "", text).strip()

    @staticmethod
    def _extract_source(url: str) -> str:
        if not url:
            return ""
        domain = urlparse(url).netloc
        return domain.replace("www.", "").split(".")[0]


def calculate_relevance(text: str, candidates: list[str], region_terms: list[str] = None) -> int:
    """게시물 관련도 점수 계산 (0-100). 기존 로직 이식."""
    score = 0

    # 후보자 이름 언급 (+30)
    if any(c in text for c in candidates):
        score += 30

    # 지역 언급 (+20)
    if region_terms and any(r in text for r in region_terms):
        score += 20

    # 교육 키워드 (+20, max 4 hits)
    edu_words = ["교육", "학교", "학생", "교사", "교장", "교감", "급식", "돌봄"]
    score += min(20, sum(1 for w in edu_words if w in text) * 5)

    # 의견 표현 (+15)
    opinion_words = ["문제", "불만", "개선", "좋", "나쁘", "심각", "찬성", "반대"]
    if any(w in text for w in opinion_words):
        score += 15

    # 최신성 보너스
    score += 15

    return min(100, score)
