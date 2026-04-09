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

# ── 이슈 분류 사전: 선거 유형별 자동 로딩 + 동의어 확장 ──
# korea_data.py의 ELECTION_ISSUES를 기반으로 카테고리별 키워드 매핑
_ISSUE_SYNONYMS = {
    # ── 교육감 ──
    "급식": ["급식", "점심", "식단", "영양", "친환경급식", "무상급식", "학교급식", "잔반", "식중독", "급식비", "로컬푸드", "식자재", "조리사", "영양사"],
    "돌봄": ["돌봄", "방과후", "늘봄", "아이돌봄", "초등돌봄", "방과후학교", "돌봄교실", "종일돌봄", "긴급돌봄", "방학돌봄", "맞벌이", "학원비"],
    "학폭": ["학교폭력", "학폭", "왕따", "집단따돌림", "사이버폭력", "괴롭힘", "따돌림", "학폭위", "폭행", "가해자", "피해학생", "신고", "은폐"],
    "교권": ["교권", "교사", "교원", "교직원", "교장", "교감", "교권보호", "기간제교사", "악성민원", "교사폭행", "교원노조", "교사처우", "교원평가", "담임", "교사부족", "교원수급"],
    "입시": ["입시", "수능", "대입", "고교학점제", "학력", "기초학력", "학력저하", "내신", "수시", "정시", "학력격차", "성적", "학업", "특목고", "자사고", "영재", "진로"],
    "예산": ["예산", "교육재정", "교육비", "재정", "특별교부금", "지방교육재정", "교부금", "교육세", "예산낭비", "결산", "세금", "지방세", "교육투자", "재정건전성", "채무", "감사"],
    "안전": ["안전", "통학", "스쿨존", "학교안전", "어린이보호", "통학버스", "학교시설", "석면", "내진", "학교환경", "급식안전", "CCTV", "범죄예방", "재난", "화재"],
    "혁신교육": ["혁신", "혁신학교", "자유학기제", "IB교육", "혁신교육", "IB", "미래교육", "교육혁신", "교육과정", "자유학년제", "토론수업", "프로젝트수업"],
    "유아교육": ["유치원", "어린이집", "유아", "보육", "누리과정", "유아교육", "유치원비", "보육료", "유보통합", "유치원교사", "놀이중심교육"],
    "디지털교육": ["디지털교육", "AI교육", "코딩교육", "에듀테크", "스마트교육", "태블릿", "디지털교과서", "온라인수업", "원격수업", "메타버스", "챗봇", "인공지능"],
    "특수교육": ["특수교육", "장애학생", "특수학교", "특수학급", "통합교육", "장애인교육", "발달장애", "장애아동", "특수교사", "보조인력"],
    "사교육": ["사교육", "학원", "사교육비", "과외", "학원비", "선행학습", "사교육경감", "사교육걱정", "입시학원", "방문학습", "학습지"],
    "과밀학급": ["학급당학생수", "과밀학급", "학급편성", "소규모학교", "학교통폐합", "분교", "폐교", "농촌학교", "학교신설", "과대학교"],
    "학생인권": ["학생인권", "정신건강", "위기학생", "심리상담", "자살", "자해", "우울", "상담교사", "Wee센터", "인권", "두발규정", "체벌", "학생자치"],
    "다문화교육": ["다문화", "다문화교육", "다문화가정", "다문화학생", "이중언어", "대안학교", "학교밖청소년", "탈북학생", "외국인학생", "이주배경"],

    # ── 기초단체장 (시장/군수/구청장) ──
    "도시개발": ["도시개발", "재개발", "재건축", "신도시", "택지개발", "도시재생", "아파트", "공공임대", "주거환경", "집값", "전세", "청년주거", "분양", "임대주택", "주택공급", "건축허가", "용적률", "지구단위"],
    "교통": ["교통", "대중교통", "도로", "BRT", "버스노선", "주차", "주차장", "자전거도로", "교통체증", "도로확장", "정체", "출퇴근", "신호등", "교차로", "보행로", "보도", "횡단보도", "트램", "지하철"],
    "일자리": ["일자리", "기업유치", "산업단지", "창업", "소상공인", "자영업", "전통시장", "상권", "청년일자리", "투자유치", "지역경제", "고용", "실업", "취업", "골목상권", "스타트업", "사회적경제", "여성일자리", "시니어일자리"],
    "복지": ["복지", "노인복지", "아동복지", "장애인복지", "기초생활", "어린이집", "보육", "출산", "저출생", "인구감소", "경로당", "노인돌봄", "아동수당", "어르신", "노인일자리", "돌봄서비스", "한부모", "취약계층"],
    "의료": ["병원", "응급의료", "보건소", "공공의료", "요양병원", "의료원", "소아과", "산부인과", "의료공백", "의료취약", "건강검진", "정신건강", "치매", "응급실", "야간진료", "동네의원"],
    "환경": ["환경", "미세먼지", "폐기물", "쓰레기", "분리수거", "상수도", "하수도", "공원", "하천", "악취", "소음", "매립지", "재활용", "음식물쓰레기", "녹지", "탄소중립", "기후변화", "수질", "대기"],
    "문화관광": ["관광", "축제", "문화센터", "도서관", "체육시설", "청소년센터", "생활체육", "문화행사", "공연장", "박물관", "미술관", "관광지", "숙박", "먹거리", "야시장", "지역축제"],

    # ── 의원 (도의원/시의원/구의원) ──
    "의정활동": ["의정활동", "의원", "시의원", "도의원", "구의원", "의회", "본회의", "임시회", "정례회", "회의록", "출석", "표결", "의장", "부의장", "국감", "행감", "행정사무감사"],
    "조례": ["조례", "조례안", "조례제정", "조례개정", "법규", "규칙", "자치법규", "의원발의", "주민발의", "입법"],
    "민원": ["민원", "주민불편", "주민요구", "진정", "청원", "생활불편", "소음신고", "불법주차", "도로보수", "가로등", "하수구", "맨홀", "포트홀", "보도블록", "도로포장"],
    "주민자치": ["주민자치", "주민참여", "주민투표", "주민센터", "마을공동체", "마을만들기", "주민총회", "참여예산", "시민참여", "공론화", "주민소환", "반상회"],

    # ── 광역단체장 (도지사/시장) ──
    "지역경제": ["지역경제", "기업유치", "투자유치", "산업유치", "균형발전", "지역소멸", "인구유출", "메가시티", "지역화폐", "상생", "수출", "무역", "특구", "경제자유구역"],
    "광역교통": ["광역교통", "KTX", "고속도로", "공항", "철도", "광역버스", "GTX", "SRT", "충북선", "충청권", "청주공항", "오송", "혁신도시", "세종", "행정수도"],
    "인구정책": ["인구", "인구감소", "인구유출", "인구소멸", "귀농", "귀촌", "청년유출", "지방소멸", "출생률", "고령화", "초고령", "독거노인"],

    # ── 농촌/군 지역 ──
    "농업": ["농업", "농촌", "농가", "축산", "축사", "귀농", "귀촌", "산림", "임야", "농산물", "로컬푸드", "직거래", "수매", "농협", "작물", "한우", "양돈", "벼농사"],
}


def _build_issue_categories(election_type: str = None) -> dict[str, list[str]]:
    """선거 유형에 맞는 이슈 카테고리 사전 빌드."""
    if not election_type:
        return _ISSUE_SYNONYMS

    from app.elections.korea_data import ELECTION_ISSUES
    type_issues = ELECTION_ISSUES.get(election_type, {}).get("issues", [])
    if not type_issues:
        return _ISSUE_SYNONYMS

    # 해당 선거 유형의 이슈 키워드를 카테고리에 매핑
    result = {}
    for category, synonyms in _ISSUE_SYNONYMS.items():
        # 카테고리 이름이나 동의어가 해당 선거 유형 이슈에 포함되면 활성화
        if category in type_issues or any(s in type_issues for s in synonyms):
            result[category] = synonyms

    # ELECTION_ISSUES에 있는데 _ISSUE_SYNONYMS에 없는 키워드 → 자체 카테고리로 추가
    covered = set()
    for syns in result.values():
        covered.update(syns)
    for issue in type_issues:
        if issue not in covered and issue not in result:
            result[issue] = [issue]

    return result if result else _ISSUE_SYNONYMS


def classify_issue(text: str, election_type: str = None) -> Optional[str]:
    """게시물 텍스트에서 이슈 카테고리 분류. 선거 유형별 최적화."""
    categories = _build_issue_categories(election_type)
    best_match = None
    best_count = 0

    for category, keywords in categories.items():
        count = sum(1 for kw in keywords if kw in text)
        if count > best_count:
            best_count = count
            best_match = category

    return best_match if best_count > 0 else None


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
        election_type: str = None,
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

                # 이슈 분류 (선거 유형별 최적화)
                issue = classify_issue(text, election_type=election_type)

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
