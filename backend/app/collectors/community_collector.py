"""
ElectionPulse - Community / Mom-cafe / Blog Collector
네이버 카페(맘카페) + 블로그 + 커뮤니티 검색 수집
키워드 기반 웹 스크래핑 (API fallback)
"""
import re
from datetime import datetime, timezone
from urllib.parse import quote
from typing import Optional

import httpx
from bs4 import BeautifulSoup
import structlog

logger = structlog.get_logger()

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.3",
}

# 교육/학부모 관련 이슈 카테고리 분류 키워드
ISSUE_CATEGORIES = {
    "급식": ["급식", "점심", "식단", "영양", "친환경급식"],
    "돌봄": ["돌봄", "방과후", "늘봄", "아이돌봄", "초등돌봄"],
    "학폭": ["학교폭력", "학폭", "왕따", "집단따돌림", "사이버폭력"],
    "교권": ["교권", "교사", "교원", "교직원", "교장"],
    "입시": ["입시", "수능", "대입", "고교학점제", "학력"],
    "예산": ["예산", "교육재정", "교육비", "재정", "특별교부금"],
    "안전": ["안전", "통학", "스쿨존", "학교안전", "어린이보호"],
    "혁신교육": ["혁신", "혁신학교", "자유학기제", "IB교육"],
    "유아교육": ["유치원", "어린이집", "유아", "보육", "누리과정"],
}


def classify_issue(text: str) -> Optional[str]:
    """게시물 텍스트에서 이슈 카테고리 분류."""
    for category, keywords in ISSUE_CATEGORIES.items():
        if any(kw in text for kw in keywords):
            return category
    return None


def calculate_relevance(text: str, candidates: list[str], region_terms: list[str] = None) -> float:
    """게시물 관련도 점수 계산 (0.0 ~ 1.0)."""
    score = 0

    # 후보자 이름 언급 (+30)
    if any(c in text for c in candidates):
        score += 30

    # 지역 언급 (+20)
    if region_terms and any(r in text for r in region_terms):
        score += 20

    # 교육 키워드 (+20, max 4 hits)
    edu_words = ["교육", "학교", "학생", "교사", "교장", "교감", "급식", "돌봄", "교육감"]
    score += min(20, sum(1 for w in edu_words if w in text) * 5)

    # 선거 키워드 (+15)
    election_words = ["선거", "후보", "공약", "투표", "출마", "당선"]
    if any(w in text for w in election_words):
        score += 15

    # 의견 표현 (+15)
    opinion_words = ["문제", "불만", "개선", "좋", "나쁘", "심각", "찬성", "반대"]
    if any(w in text for w in opinion_words):
        score += 15

    return min(1.0, score / 100.0)


class CommunityCollector:
    """네이버 카페/블로그/커뮤니티 수집기."""

    def __init__(self, client_id: str = "", client_secret: str = ""):
        self.client_id = client_id
        self.client_secret = client_secret

    async def collect_cafe_posts(
        self,
        keyword: str,
        display: int = 15,
        sort: str = "date",
    ) -> list[dict]:
        """
        네이버 카페 검색 (웹 스크래핑).
        맘카페, 지역 커뮤니티 등의 글 수집.
        """
        # API 시도 먼저
        if self.client_id:
            posts = await self._api_cafe(keyword, display)
            if posts:
                return posts

        # 스크래핑 fallback
        return await self._scrape_cafe(keyword, display)

    async def collect_blog_posts(
        self,
        keyword: str,
        display: int = 15,
        sort: str = "date",
    ) -> list[dict]:
        """네이버 블로그 검색."""
        if self.client_id:
            posts = await self._api_blog(keyword, display)
            if posts:
                return posts

        return await self._scrape_blog(keyword, display)

    async def collect_all(
        self,
        keywords: list[str],
        candidate_names: list[str],
        region_terms: list[str] = None,
        max_per_keyword: int = 10,
    ) -> list[dict]:
        """
        모든 소스에서 수집 + 관련도/감성 분석.
        Returns: [{title, url, source, content_snippet, platform,
                   sentiment, sentiment_score, issue_category,
                   relevance_score, engagement}, ...]
        """
        from app.analysis.sentiment import SentimentAnalyzer
        analyzer = SentimentAnalyzer()

        all_posts = []
        seen_urls = set()

        for keyword in keywords:
            # 카페 검색
            cafe_posts = await self.collect_cafe_posts(keyword, display=max_per_keyword)
            # 블로그 검색
            blog_posts = await self.collect_blog_posts(keyword, display=max_per_keyword)

            for post in cafe_posts + blog_posts:
                url = post.get("url", "")
                if url in seen_urls:
                    continue
                seen_urls.add(url)

                text = f"{post['title']} {post.get('description', '')}"

                # 감성 분석
                sentiment, score = analyzer.analyze(text)

                # 이슈 분류
                issue = classify_issue(text)

                # 관련도
                relevance = calculate_relevance(text, candidate_names, region_terms)

                all_posts.append({
                    "title": post["title"],
                    "url": url,
                    "source": post.get("author", "") or post.get("cafe_name", ""),
                    "content_snippet": post.get("description", "")[:200],
                    "platform": post.get("platform", "naver_cafe"),
                    "sentiment": sentiment,
                    "sentiment_score": score,
                    "issue_category": issue,
                    "relevance_score": relevance,
                    "engagement": {
                        "views": post.get("views", 0),
                        "comments": post.get("comments", 0),
                        "likes": post.get("likes", 0),
                    },
                    "pub_date": post.get("pub_date"),
                })

        logger.info(
            "community_collected",
            keywords=len(keywords),
            total=len(all_posts),
        )
        return all_posts

    # ──────────────── API Methods ──────────────────────────────

    async def _api_cafe(self, keyword: str, display: int) -> list[dict]:
        """네이버 카페 검색 API."""
        url = "https://openapi.naver.com/v1/search/cafearticle.json"
        params = {"query": keyword, "display": display, "sort": "date"}
        headers = {
            "X-Naver-Client-Id": self.client_id,
            "X-Naver-Client-Secret": self.client_secret,
        }
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(url, params=params, headers=headers, timeout=15)
                if resp.status_code == 401:
                    logger.warning("naver_cafe_api_401", keyword=keyword)
                    return []
                resp.raise_for_status()
                data = resp.json()
                posts = []
                for item in data.get("items", []):
                    posts.append({
                        "title": self._clean_html(item.get("title", "")),
                        "url": item.get("link", ""),
                        "author": "",
                        "cafe_name": item.get("cafename", ""),
                        "description": self._clean_html(item.get("description", ""))[:200],
                        "pub_date": None,
                        "platform": "naver_cafe",
                    })
                return posts
            except Exception as e:
                logger.error("naver_cafe_api_error", keyword=keyword, error=str(e))
                return []

    async def _api_blog(self, keyword: str, display: int) -> list[dict]:
        """네이버 블로그 검색 API."""
        url = "https://openapi.naver.com/v1/search/blog.json"
        params = {"query": keyword, "display": display, "sort": "date"}
        headers = {
            "X-Naver-Client-Id": self.client_id,
            "X-Naver-Client-Secret": self.client_secret,
        }
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(url, params=params, headers=headers, timeout=15)
                if resp.status_code == 401:
                    logger.warning("naver_blog_api_401", keyword=keyword)
                    return []
                resp.raise_for_status()
                data = resp.json()
                posts = []
                for item in data.get("items", []):
                    posts.append({
                        "title": self._clean_html(item.get("title", "")),
                        "url": item.get("link", ""),
                        "author": item.get("bloggername", ""),
                        "description": self._clean_html(item.get("description", ""))[:200],
                        "pub_date": item.get("postdate"),
                        "platform": "naver_blog",
                    })
                return posts
            except Exception as e:
                logger.error("naver_blog_api_error", keyword=keyword, error=str(e))
                return []

    # ──────────────── Scraping Methods ─────────────────────────

    async def _scrape_cafe(self, keyword: str, count: int = 15) -> list[dict]:
        """네이버 카페 웹 스크래핑."""
        encoded = quote(keyword)
        url = f"https://search.naver.com/search.naver?where=article&query={encoded}&st=date"

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(url, headers=HEADERS, timeout=15)
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "html.parser")

                posts = []
                # 카페 글 컨테이너 탐색
                for item in soup.select(".cafe_article_wrap, .api_cont_area, .lst_item"):
                    title_el = item.select_one("a.api_txt_lines, a.title_link, .tit_area a")
                    if not title_el:
                        continue

                    title = title_el.get_text(strip=True)
                    if len(title) < 5:
                        continue

                    href = title_el.get("href", "")
                    if not href or "naver.com/search" in href:
                        continue

                    # 설명 추출
                    desc = ""
                    desc_el = item.select_one(".dsc_txt, .api_txt_lines.dsc, .txt_area")
                    if desc_el:
                        desc = desc_el.get_text(strip=True)[:200]

                    # 카페명 추출
                    cafe_name = ""
                    cafe_el = item.select_one(".cafe_name, .sub_txt .name, .etc_area .txt")
                    if cafe_el:
                        cafe_name = cafe_el.get_text(strip=True)

                    posts.append({
                        "title": title,
                        "url": href,
                        "author": "",
                        "cafe_name": cafe_name,
                        "description": desc,
                        "pub_date": None,
                        "platform": "naver_cafe",
                    })

                # 구조화된 결과가 없으면 generic link 탐색
                if not posts:
                    posts = self._generic_link_scrape(soup, "naver_cafe", count)

                posts = self._deduplicate(posts)[:count]
                logger.info("cafe_scraped", keyword=keyword, count=len(posts))
                return posts

            except Exception as e:
                logger.error("cafe_scrape_error", keyword=keyword, error=str(e))
                return []

    async def _scrape_blog(self, keyword: str, count: int = 15) -> list[dict]:
        """네이버 블로그 웹 스크래핑."""
        encoded = quote(keyword)
        url = f"https://search.naver.com/search.naver?where=blog&query={encoded}&sm=tab_opt&sort=1"

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(url, headers=HEADERS, timeout=15)
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "html.parser")

                posts = []
                for item in soup.select(".blog_list, .api_cont_area, .lst_item"):
                    title_el = item.select_one("a.api_txt_lines, a.title_link, .tit_area a")
                    if not title_el:
                        continue

                    title = title_el.get_text(strip=True)
                    if len(title) < 5:
                        continue

                    href = title_el.get("href", "")
                    if not href or "naver.com/search" in href:
                        continue

                    desc = ""
                    desc_el = item.select_one(".dsc_txt, .api_txt_lines.dsc, .txt_area")
                    if desc_el:
                        desc = desc_el.get_text(strip=True)[:200]

                    author = ""
                    author_el = item.select_one(".sub_txt .name, .blog_name, .nickname")
                    if author_el:
                        author = author_el.get_text(strip=True)

                    platform = "naver_blog"
                    if "tistory" in href:
                        platform = "tistory"

                    posts.append({
                        "title": title,
                        "url": href,
                        "author": author,
                        "description": desc,
                        "pub_date": None,
                        "platform": platform,
                    })

                if not posts:
                    posts = self._generic_link_scrape(soup, "naver_blog", count)

                posts = self._deduplicate(posts)[:count]
                logger.info("blog_scraped", keyword=keyword, count=len(posts))
                return posts

            except Exception as e:
                logger.error("blog_scrape_error", keyword=keyword, error=str(e))
                return []

    # ──────────────── Helpers ──────────────────────────────────

    def _generic_link_scrape(self, soup: BeautifulSoup, platform: str, count: int) -> list[dict]:
        """CSS selector 매칭 실패 시 generic <a> 탐색."""
        posts = []
        for a_tag in soup.find_all("a", href=True):
            href = a_tag.get("href", "")
            title = a_tag.get_text(strip=True)
            if len(title) < 10:
                continue
            if "naver.com/search" in href:
                continue
            if any(x in title for x in ["언론사 선정", "네이버 메인에서", "구독하세요"]):
                continue

            is_target = any(x in href for x in ["blog.naver", "cafe.naver", "tistory"])
            if not is_target:
                continue

            desc = ""
            parent = a_tag.find_parent(["li", "div"])
            if parent:
                for cls in ["api_txt_lines", "dsc_txt", "txt_area"]:
                    el = parent.find("div", class_=lambda c: c and cls in str(c))
                    if el:
                        desc = el.get_text(strip=True)[:200]
                        break

            actual_platform = platform
            if "cafe" in href:
                actual_platform = "naver_cafe"
            elif "tistory" in href:
                actual_platform = "tistory"

            posts.append({
                "title": title,
                "url": href,
                "author": "",
                "description": desc,
                "pub_date": None,
                "platform": actual_platform,
            })

        return posts[:count]

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
