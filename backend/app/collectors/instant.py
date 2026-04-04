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
    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == tenant_id,
            Candidate.enabled == True,
        )
    )).scalars().all()

    collector = NaverCollector(settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET)
    analyzer = SentimentAnalyzer()
    total = 0
    collected_articles = []  # For comment collection

    for cand in candidates:
        homonym = None
        if cand.homonym_filters:
            homonym = {"exclude": cand.homonym_filters, "require_any": ["교육", "선거", "후보", "교육감"]}

        for keyword in (cand.search_keywords or [cand.name]):
            search_kw = f"{keyword} 교육감" if "교육감" not in keyword else keyword
            articles = await collector.search_news(search_kw, display=15, homonym_filters=homonym)

            for article in articles:
                exists = (await db.execute(
                    select(NewsArticle).where(
                        NewsArticle.tenant_id == tenant_id,
                        NewsArticle.url == article["url"],
                    )
                )).scalar_one_or_none()
                if exists:
                    continue

                text = f"{article['title']} {article.get('description', '')}"
                sentiment, score = analyzer.analyze(text)

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


async def collect_community_now(db: AsyncSession, tenant_id: str, election_id: str) -> dict:
    """커뮤니티/카페/블로그 즉시 수집."""
    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == tenant_id,
            Candidate.enabled == True,
        )
    )).scalars().all()

    community_collector = CommunityCollector(
        settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET
    )
    cand_names = [c.name for c in candidates]
    total = 0

    for cand in candidates:
        keywords = cand.search_keywords or [cand.name]
        # Add education-related keyword variants
        search_keywords = []
        for kw in keywords:
            search_keywords.append(kw)
            if "교육감" not in kw:
                search_keywords.append(f"{kw} 교육감")

        posts = await community_collector.collect_all(
            keywords=search_keywords,
            candidate_names=cand_names,
            max_per_keyword=8,
        )

        for post in posts:
            exists = (await db.execute(
                select(CommunityPost).where(
                    CommunityPost.tenant_id == tenant_id,
                    CommunityPost.url == post["url"],
                )
            )).scalar_one_or_none()
            if exists:
                continue

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
            ))
            total += 1

    await db.flush()
    logger.info("instant_community_collected", tenant_id=tenant_id, total=total)
    return {"type": "community", "collected": total}


async def collect_youtube_now(db: AsyncSession, tenant_id: str, election_id: str) -> dict:
    """유튜브 즉시 수집 (일반 영상 + 숏츠 + 댓글)."""
    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id, Candidate.tenant_id == tenant_id, Candidate.enabled == True,
        )
    )).scalars().all()

    collector = YouTubeCollector(settings.YOUTUBE_API_KEY or settings.GOOGLE_API_KEY)
    analyzer = SentimentAnalyzer()
    total = 0

    for cand in candidates:
        for keyword in (cand.search_keywords or [cand.name]):
            # Regular videos
            videos = await collector.search_videos(keyword, max_results=5)
            # Shorts
            shorts = await collector.search_shorts(keyword, max_results=5)

            for vid in videos + shorts:
                exists = (await db.execute(
                    select(YouTubeVideo).where(YouTubeVideo.tenant_id == tenant_id, YouTubeVideo.video_id == vid["video_id"])
                )).scalar_one_or_none()
                if exists:
                    # Update stats if higher
                    if vid.get("views", 0) > (exists.views or 0):
                        exists.views = vid["views"]
                        exists.likes = vid.get("likes", 0)
                        exists.comments_count = vid.get("comments_count", 0)
                    continue

                sentiment, score = analyzer.analyze(vid["title"])
                db.add(YouTubeVideo(
                    tenant_id=tenant_id, election_id=election_id, candidate_id=cand.id,
                    video_id=vid["video_id"], title=vid["title"], channel=vid.get("channel", ""),
                    description_snippet=vid.get("description", "")[:300],
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

    logger.info(
        "instant_all_collected",
        tenant_id=tenant_id,
        total_items=total_items,
        total_comments=total_comments,
    )

    return {
        "type": "all",
        "collected": total_items,
        "comments": total_comments,
        "details": results,
    }
