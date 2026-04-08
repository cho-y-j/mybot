"""
ElectionPulse - Instant Collection (동기 실행)
대시보드에서 "지금 수집" 버튼 클릭 시 즉시 실행.
Celery 없이도 작동 (개발/테스트용).
"""
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.collectors.naver import NaverCollector
from app.collectors.youtube import YouTubeCollector
from app.collectors.community_collector import CommunityCollector
from app.analysis.sentiment import SentimentAnalyzer
from app.elections.models import (
    Candidate, NewsArticle, CommunityPost, YouTubeVideo, SearchTrend,
)
from app.config import get_settings
import structlog

logger = structlog.get_logger()
settings = get_settings()


async def collect_news_now(db: AsyncSession, tenant_id: str, election_id: str) -> dict:
    """뉴스 즉시 수집 + 댓글 수집 (async)."""
    from app.elections.models import Election
    from app.elections.korea_data import ELECTION_ISSUES, REGIONS

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == tenant_id,
            Candidate.enabled == True,
        )
    )).scalars().all()

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()

    # 선거 유형/지역 기반 동적 컨텍스트 (교육감 하드코딩 제거)
    election_type = (election.election_type if election else "mayor")
    _raw_label = ELECTION_ISSUES.get(election_type, {}).get("label", "후보")
    type_label = _raw_label.split("(")[0].strip().split(" ")[0]  # 시장/도지사/교육감/...
    region_short = REGIONS.get(election.region_sido, {}).get("short", "") if election and election.region_sido else ""
    region_full = election.region_sido if election and election.region_sido else ""
    region_sigungu = election.region_sigungu if election and election.region_sigungu else ""

    # 동적 require_any: 일반 선거 단어 + 지역 + 직위
    base_relevance = ["선거", "후보", "공약", "캠프", "출마", "지지", "유세", "경선", "공천"]
    require_any = base_relevance + [w for w in [type_label, region_short, region_full, region_sigungu] if w]

    collector = NaverCollector(settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET)
    analyzer = SentimentAnalyzer()
    total = 0
    collected_articles = []  # For comment collection

    for cand in candidates:
        homonym = {
            "exclude": (cand.homonym_filters or []) + GLOBAL_HOMONYM_BLOCK,
            "require_any": require_any,
            # 후보 이름이 본문에 반드시 있어야 함 (네이버가 동명이인/관련 인물 기사 반환해도 차단)
            "require_name": [cand.name],
        }

        # 검색 키워드 — 후보별 키워드 + 직위/지역 보강 (이미 포함되어 있으면 중복 X)
        search_kws = []
        for keyword in (cand.search_keywords or [cand.name]):
            search_kws.append(keyword)
        # 보강: "이름 + 직위", "이름 + 지역 + 직위" 두 형태 추가
        search_kws.append(f"{cand.name} {type_label}")
        if region_short:
            search_kws.append(f"{cand.name} {region_short} {type_label}")
        # 중복 제거
        search_kws = list(dict.fromkeys(search_kws))

        for search_kw in search_kws:
            articles = await collector.search_news(search_kw, display=30, homonym_filters=homonym)

            for article in articles:
                url = article.get("url", "")
                # 비뉴스 URL 필터
                if any(x in url for x in ["help.naver", "naver.com/alias", "naver.com/search", "terms.naver", "policy.naver"]):
                    continue
                # 제목이 너무 짧거나 뉴스가 아닌 것 필터
                title = article.get("title", "")
                if len(title) < 10 or any(x in title for x in ["접수해주세요", "이용약관", "고객센터"]):
                    continue

                exists = (await db.execute(
                    select(NewsArticle).where(
                        NewsArticle.tenant_id == tenant_id,
                        NewsArticle.url == url,
                    )
                )).scalar_one_or_none()
                if exists:
                    continue

                text = f"{article['title']} {article.get('description', '')}"
                sentiment, score = analyzer.analyze(text)

                # published_at 파싱
                pub_at = None
                if article.get("pub_date"):
                    try:
                        from dateutil import parser as dateparser
                        pub_at = dateparser.parse(article["pub_date"])
                    except Exception:
                        pass

                db.add(NewsArticle(
                    tenant_id=tenant_id,
                    election_id=election_id,
                    candidate_id=cand.id,
                    title=article["title"],
                    url=article["url"],
                    source=article.get("source", ""),
                    summary=article.get("description", "")[:300],
                    sentiment=sentiment,
                    sentiment_score=score,
                    platform="naver",
                    published_at=pub_at,
                ))
                total += 1

                # Track for comment collection
                collected_articles.append({
                    "url": article["url"],
                    "title": article["title"],
                    "candidate": cand.name,
                })

    # Collect comments for naver news articles
    comment_count = 0
    try:
        comment_count = await _collect_news_comments(
            db, tenant_id, collected_articles, analyzer
        )
    except Exception as e:
        logger.error("news_comment_collection_error", error=str(e))

    await db.flush()
    logger.info("instant_news_collected", tenant_id=tenant_id, total=total, comments=comment_count)
    return {"type": "news", "collected": total, "comments": comment_count}


async def _collect_news_comments(
    db: AsyncSession,
    tenant_id: str,
    articles: list[dict],
    analyzer: SentimentAnalyzer,
) -> int:
    """수집된 뉴스 기사의 댓글 수집."""
    from app.collectors.news_comments import collect_comments_for_articles
    from app.elections.history_models import NewsComment

    # 네이버 뉴스 URL만 필터
    naver_articles = [
        a for a in articles
        if "news.naver.com" in a.get("url", "")
    ]

    if not naver_articles:
        return 0

    results = await collect_comments_for_articles(naver_articles, max_per_article=10)
    count = 0

    for article_result in results:
        for comment in article_result.get("comments", []):
            text = comment.get("text", "")
            if not text:
                continue

            sentiment, _ = analyzer.analyze(text)

            db.add(NewsComment(
                tenant_id=tenant_id,
                article_url=article_result["url"],
                author=comment.get("author", ""),
                text=text[:500],
                sympathy_count=comment.get("sympathy", 0),
                antipathy_count=comment.get("antipathy", 0),
                sentiment=sentiment,
                candidate_name=article_result.get("candidate", ""),
            ))
            count += 1

    return count


# 모든 후보 공통으로 무조건 차단할 동명이인 키워드
GLOBAL_HOMONYM_BLOCK = [
    "산은캐피탈", "캐피탈", "사외이사", "은행장", "증권", "저축은행",
    "병장", "일병", "이병", "상병", "해병대", "경찰청장",
    "야구", "축구", "프로골프", "선수", "감독님",
    "배우", "탤런트", "가수", "아이돌", "드라마",
    "교수님", "박사학위", "논문", "수상자", "장학금",
]


async def collect_community_now(db: AsyncSession, tenant_id: str, election_id: str) -> dict:
    """커뮤니티/카페/블로그 즉시 수집."""
    from app.elections.models import Election
    from app.elections.korea_data import ELECTION_ISSUES, REGIONS

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == tenant_id,
            Candidate.enabled == True,
        )
    )).scalars().all()

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()

    election_type = (election.election_type if election else "mayor")
    # 라벨에서 괄호 설명 제거하고 짧은 형태만 사용 ("시장 (기초단체장)" → "시장")
    _raw_label = ELECTION_ISSUES.get(election_type, {}).get("label", "후보")
    type_label = _raw_label.split("(")[0].strip().split(" ")[0]
    region_short = REGIONS.get(election.region_sido, {}).get("short", "") if election and election.region_sido else ""
    region_full = election.region_sido if election and election.region_sido else ""
    region_sigungu = election.region_sigungu if election and election.region_sigungu else ""

    community_collector = CommunityCollector(
        settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET
    )
    cand_names = [c.name for c in candidates]
    total = 0

    for cand in candidates:
        keywords = cand.search_keywords or [cand.name]
        # 직위/지역 기반 검색 키워드 보강 (교육감 하드코딩 제거)
        search_keywords = []
        for kw in keywords:
            search_keywords.append(kw)
        # 보강: "이름 + 직위", "이름 + 지역 + 직위"
        search_keywords.append(f"{cand.name} {type_label}")
        if region_short:
            search_keywords.append(f"{cand.name} {region_short} {type_label}")
        search_keywords = list(dict.fromkeys(search_keywords))

        posts = await community_collector.collect_all(
            keywords=search_keywords,
            candidate_names=cand_names,
            max_per_keyword=8,
        )

        # 동명이인 필터링 (동적 + GLOBAL block)
        exclude_words = (cand.homonym_filters or []) + GLOBAL_HOMONYM_BLOCK
        base_relevance = ["선거", "후보", "공약", "캠프", "출마", "지지", "유세", "경선", "공천"]
        relevance_words = base_relevance + [w for w in [type_label, region_short, region_full, region_sigungu] if w]

        for post in posts:
            title = post.get("title", "")
            content = post.get("content_snippet", "")
            text_full = f"{title} {content}"
            text = text_full.lower()

            # 1. GLOBAL/캠프별 차단 키워드
            if exclude_words and any(w.lower() in text for w in exclude_words):
                continue

            # 2. 후보 이름이 본문에 반드시 있어야 함 (네이버가 동명이인/관련 인물 결과 반환해도 차단)
            if cand.name not in text_full:
                continue

            # 3. 정치/지역 컨텍스트 단어가 하나라도 있어야 함
            if not any(w in text for w in relevance_words):
                continue

            exists = (await db.execute(
                select(CommunityPost).where(
                    CommunityPost.tenant_id == tenant_id,
                    CommunityPost.url == post["url"],
                )
            )).scalar_one_or_none()
            if exists:
                continue

            # published_at 파싱
            pub_at = None
            if post.get("pub_date"):
                try:
                    from dateutil import parser as dateparser
                    pub_at = dateparser.parse(post["pub_date"])
                except Exception:
                    pass

            db.add(CommunityPost(
                tenant_id=tenant_id,
                election_id=election_id,
                candidate_id=cand.id,
                title=post["title"],
                url=post["url"],
                source=post.get("source", ""),
                content_snippet=post.get("content_snippet", "")[:200],
                sentiment=post.get("sentiment", "neutral"),
                sentiment_score=post.get("sentiment_score", 0.0),
                issue_category=post.get("issue_category"),
                relevance_score=post.get("relevance_score", 0.0),
                engagement=post.get("engagement", {}),
                platform=post.get("platform", "naver_cafe"),
                published_at=pub_at,
            ))
            total += 1

    await db.flush()
    logger.info("instant_community_collected", tenant_id=tenant_id, total=total)
    return {"type": "community", "collected": total}


async def collect_youtube_now(db: AsyncSession, tenant_id: str, election_id: str) -> dict:
    """유튜브 즉시 수집 (일반 영상 + 숏츠 + 댓글) — 동명이인 필터 적용."""
    from app.elections.models import Election
    from app.elections.korea_data import ELECTION_ISSUES, REGIONS

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id, Candidate.tenant_id == tenant_id, Candidate.enabled == True,
        )
    )).scalars().all()

    # 선거 정보 (유형 + 지역)
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()

    election_type = election.election_type if election else "superintendent"
    # 라벨에서 괄호 설명 제거하고 짧은 형태만 사용 ("시장 (기초단체장)" → "시장")
    _raw_label = ELECTION_ISSUES.get(election_type, {}).get("label", "후보")
    type_label = _raw_label.split("(")[0].strip().split(" ")[0]
    region_short = REGIONS.get(election.region_sido, {}).get("short", "") if election else ""

    # 선거 관련 키워드 (동명이인 필터용) — 동적 (election_type/지역 기반)
    region_full = election.region_sido if election and election.region_sido else ""
    region_sigungu = election.region_sigungu if election and election.region_sigungu else ""
    base_relevance = ["선거", "후보", "공약", "캠프", "출마", "지지", "유세", "경선", "공천", "토론", "인터뷰"]
    relevance_words = base_relevance + [w for w in [type_label, region_short, region_full, region_sigungu] if w]

    collector = YouTubeCollector(settings.YOUTUBE_API_KEY or settings.GOOGLE_API_KEY)
    analyzer = SentimentAnalyzer()
    total = 0
    filtered = 0

    for cand in candidates:
        exclude_words = (cand.homonym_filters or []) + GLOBAL_HOMONYM_BLOCK

        # 검색 키워드: "이름 직위"로 검색하여 동명이인 최소화
        search_keywords = []
        for keyword in (cand.search_keywords or [cand.name]):
            if type_label not in keyword and region_short not in keyword:
                search_keywords.append(f"{keyword} {type_label}")
            else:
                search_keywords.append(keyword)
        # 이름만으로도 1회 검색 (범위 넓힘)
        if cand.name not in search_keywords:
            search_keywords.append(f"{cand.name} {region_short} {type_label}")

        for keyword in search_keywords[:3]:  # 최대 3개 키워드
            # Regular videos
            videos = await collector.search_videos(keyword, max_results=5)
            # Shorts
            shorts = await collector.search_shorts(keyword, max_results=3)

            for vid in videos + shorts:
                title = vid.get("title", "")
                desc = vid.get("description", "")
                text_full = f"{title} {desc}"
                text = text_full.lower()

                # 1. 동명이인 차단 키워드 (GLOBAL + 캠프별)
                if exclude_words and any(w.lower() in text for w in exclude_words):
                    filtered += 1
                    continue

                # 2. 후보 이름이 제목/설명에 반드시 있어야 함
                if cand.name not in text_full:
                    filtered += 1
                    continue

                # 3. 선거/지역 컨텍스트 단어가 하나라도 있어야 함
                if not any(w in text for w in relevance_words):
                    filtered += 1
                    continue

                exists = (await db.execute(
                    select(YouTubeVideo).where(YouTubeVideo.tenant_id == tenant_id, YouTubeVideo.video_id == vid["video_id"])
                )).scalar_one_or_none()
                if exists:
                    if vid.get("views", 0) > (exists.views or 0):
                        exists.views = vid["views"]
                        exists.likes = vid.get("likes", 0)
                        exists.comments_count = vid.get("comments_count", 0)
                    continue

                # 감성 분석 (제목 + 설명)
                sentiment, score = analyzer.analyze(f"{title} {desc[:200]}")
                db.add(YouTubeVideo(
                    tenant_id=tenant_id, election_id=election_id, candidate_id=cand.id,
                    video_id=vid["video_id"], title=title, channel=vid.get("channel", ""),
                    description_snippet=desc[:300],
                    thumbnail_url=vid.get("thumbnail", ""),
                    views=vid.get("views", 0), likes=vid.get("likes", 0),
                    comments_count=vid.get("comments_count", 0),
                    sentiment=sentiment, sentiment_score=score,
                ))
                total += 1

    # Collect comments for top videos per candidate
    comment_count = 0
    from app.elections.history_models import YouTubeComment
    for cand in candidates:
        vids = (await db.execute(
            select(YouTubeVideo).where(YouTubeVideo.candidate_id == cand.id)
            .order_by(YouTubeVideo.views.desc()).limit(3)
        )).scalars().all()

        for v in vids:
            comments = await collector.get_video_comments(v.video_id, max_results=10)
            for c in comments:
                sentiment, _ = analyzer.analyze(c.get("text", ""))
                db.add(YouTubeComment(
                    tenant_id=tenant_id,
                    video_id=v.video_id,
                    author=c.get("author", ""),
                    text=c.get("text", "")[:500],
                    like_count=c.get("likes", 0),
                    sentiment=sentiment,
                    candidate_name=cand.name,
                ))
                comment_count += 1

    await db.flush()
    return {"type": "youtube", "collected": total, "comments": comment_count}


async def collect_all_now(db: AsyncSession, tenant_id: str, election_id: str) -> dict:
    """전체 수집 (뉴스+댓글 + 커뮤니티 + 유튜브+숏츠+댓글)."""
    results = []

    news_result = await collect_news_now(db, tenant_id, election_id)
    results.append(news_result)

    community_result = await collect_community_now(db, tenant_id, election_id)
    results.append(community_result)

    youtube_result = await collect_youtube_now(db, tenant_id, election_id)
    results.append(youtube_result)

    total_items = sum(r.get("collected", 0) for r in results)
    total_comments = sum(r.get("comments", 0) for r in results)

    await db.commit()

    # 수집 직후 새 콘텐츠에 AI 분석 자동 실행
    ai_result = {"total_analyzed": 0, "total_threats": 0}
    if total_items > 0:
        try:
            from app.analysis.media_analyzer import analyze_all_media
            ai_result = await analyze_all_media(db, tenant_id, election_id, limit_per_type=20)
            logger.info("instant_ai_analyzed",
                       analyzed=ai_result["total_analyzed"],
                       threats=ai_result["total_threats"])
        except Exception as e:
            logger.error("instant_ai_error", error=str(e))

    logger.info(
        "instant_all_collected",
        tenant_id=tenant_id,
        total_items=total_items,
        total_comments=total_comments,
        ai_analyzed=ai_result["total_analyzed"],
    )

    return {
        "type": "all",
        "collected": total_items,
        "comments": total_comments,
        "ai_analyzed": ai_result.get("total_analyzed", 0),
        "ai_threats": ai_result.get("total_threats", 0),
        "details": results,
    }
