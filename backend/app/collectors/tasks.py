"""
ElectionPulse - Celery Collection Tasks
기존 프로토타입의 검증된 수집 로직을 비동기 태스크로 통합
"""
import asyncio
from datetime import datetime, timezone, timedelta, date
from uuid import UUID

from celery import Celery
from sqlalchemy import select, create_engine
from sqlalchemy.orm import Session

from app.config import get_settings
import structlog

logger = structlog.get_logger()
settings = get_settings()

# KST timezone
KST = timezone(timedelta(hours=9))

# ── Celery App ──
celery_app = Celery(
    "electionpulse",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.REDIS_URL,
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Seoul",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=600,
    worker_max_tasks_per_child=100,
)

# ── Sync DB (Celery worker용) ──
SYNC_DB_URL = settings.DATABASE_URL.replace("+asyncpg", "+psycopg2")
sync_engine = create_engine(SYNC_DB_URL, pool_pre_ping=True)


def get_sync_session() -> Session:
    return Session(sync_engine)


def _run_async(coro):
    """Celery (sync) 안에서 async 코드 실행."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


# ──────────────── NEWS COLLECTION ──────────────────────────────

@celery_app.task(bind=True, name="collect.news")
def collect_news(self, tenant_id: str, election_id: str, schedule_id: str):
    """뉴스 수집: 후보별 키워드로 검색 → 감성분석 → DB 저장."""
    from app.collectors.naver import NaverCollector
    from app.analysis.sentiment import SentimentAnalyzer
    from app.elections.models import ScheduleRun, Candidate, NewsArticle

    session = get_sync_session()
    run = ScheduleRun(schedule_id=schedule_id, tenant_id=tenant_id, status="running")
    session.add(run)
    session.commit()

    try:
        candidates = session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.tenant_id == tenant_id,
                Candidate.enabled == True,
            )
        ).scalars().all()

        collector = NaverCollector(settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET)
        analyzer = SentimentAnalyzer()
        total = 0

        for cand in candidates:
            # 동명이인 필터 구성
            homonym = None
            if cand.homonym_filters:
                homonym = {
                    "exclude": cand.homonym_filters,
                    "require_any": ["교육", "선거", "후보", "교육감", "출마"],
                }

            for keyword in (cand.search_keywords or [cand.name]):
                articles = _run_async(
                    collector.search_news(keyword, display=15, homonym_filters=homonym)
                )

                for article in articles:
                    # 중복 확인
                    exists = session.execute(
                        select(NewsArticle).where(
                            NewsArticle.tenant_id == tenant_id,
                            NewsArticle.url == article["url"],
                        )
                    ).scalar_one_or_none()
                    if exists:
                        continue

                    # 감성 분석
                    text = f"{article['title']} {article.get('description', '')}"
                    sentiment, score = analyzer.analyze(text)

                    session.add(NewsArticle(
                        tenant_id=tenant_id,
                        election_id=election_id,
                        candidate_id=cand.id,
                        title=article["title"],
                        url=article["url"],
                        source=article.get("source", ""),
                        summary=article.get("description", "")[:300],
                        sentiment=sentiment,
                        sentiment_score=score,
                        platform=article.get("platform", "naver"),
                    ))
                    total += 1

        session.commit()

        # 실행 기록 업데이트
        run.status = "success"
        run.completed_at = datetime.now(timezone.utc)
        run.items_collected = total
        run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        session.commit()

        return {"status": "success", "items": total}

    except Exception as e:
        run.status = "failed"
        run.error_message = str(e)[:500]
        run.completed_at = datetime.now(timezone.utc)
        session.commit()
        raise
    finally:
        session.close()


# ──────────────── COMMUNITY COLLECTION ─────────────────────────

@celery_app.task(bind=True, name="collect.community")
def collect_community(self, tenant_id: str, election_id: str, schedule_id: str):
    """블로그/카페 수집."""
    from app.collectors.naver import NaverCollector, calculate_relevance
    from app.analysis.sentiment import SentimentAnalyzer
    from app.elections.models import ScheduleRun, Candidate, CommunityPost

    session = get_sync_session()
    run = ScheduleRun(schedule_id=schedule_id, tenant_id=tenant_id, status="running")
    session.add(run)
    session.commit()

    try:
        candidates = session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.tenant_id == tenant_id,
                Candidate.enabled == True,
            )
        ).scalars().all()

        collector = NaverCollector(settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET)
        analyzer = SentimentAnalyzer()
        cand_names = [c.name for c in candidates]
        total = 0

        for cand in candidates:
            for keyword in (cand.search_keywords or [cand.name]):
                # 블로그 + 카페 검색
                blog_posts = _run_async(collector.search_blog(keyword, display=10))
                cafe_posts = _run_async(collector.search_cafe(keyword, display=10))
                all_posts = blog_posts + cafe_posts

                for post in all_posts:
                    exists = session.execute(
                        select(CommunityPost).where(
                            CommunityPost.tenant_id == tenant_id,
                            CommunityPost.url == post["url"],
                        )
                    ).scalar_one_or_none()
                    if exists:
                        continue

                    text = f"{post['title']} {post.get('description', '')}"
                    sentiment, score = analyzer.analyze(text)
                    relevance = calculate_relevance(text, cand_names)

                    session.add(CommunityPost(
                        tenant_id=tenant_id,
                        election_id=election_id,
                        candidate_id=cand.id,
                        title=post["title"],
                        url=post["url"],
                        source=post.get("author", ""),
                        content_snippet=post.get("description", "")[:200],
                        sentiment=sentiment,
                        sentiment_score=score,
                        relevance_score=relevance / 100.0,
                        platform=post.get("platform", "naver_blog"),
                    ))
                    total += 1

        session.commit()
        run.status = "success"
        run.completed_at = datetime.now(timezone.utc)
        run.items_collected = total
        run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        session.commit()
        return {"status": "success", "items": total}

    except Exception as e:
        run.status = "failed"
        run.error_message = str(e)[:500]
        run.completed_at = datetime.now(timezone.utc)
        session.commit()
        raise
    finally:
        session.close()


# ──────────────── YOUTUBE COLLECTION ───────────────────────────

@celery_app.task(bind=True, name="collect.youtube")
def collect_youtube(self, tenant_id: str, election_id: str, schedule_id: str):
    """유튜브 영상 수집."""
    from app.collectors.youtube import YouTubeCollector
    from app.analysis.sentiment import SentimentAnalyzer
    from app.elections.models import ScheduleRun, Candidate, YouTubeVideo

    session = get_sync_session()
    run = ScheduleRun(schedule_id=schedule_id, tenant_id=tenant_id, status="running")
    session.add(run)
    session.commit()

    try:
        candidates = session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.tenant_id == tenant_id,
                Candidate.enabled == True,
            )
        ).scalars().all()

        collector = YouTubeCollector(settings.YOUTUBE_API_KEY or settings.GOOGLE_API_KEY)
        analyzer = SentimentAnalyzer()
        total = 0

        for cand in candidates:
            for keyword in (cand.search_keywords or [cand.name]):
                videos = _run_async(collector.search_videos(keyword, max_results=10))

                for vid in videos:
                    exists = session.execute(
                        select(YouTubeVideo).where(
                            YouTubeVideo.tenant_id == tenant_id,
                            YouTubeVideo.video_id == vid["video_id"],
                        )
                    ).scalar_one_or_none()

                    if exists:
                        # 조회수 업데이트 (MAX)
                        if vid.get("views", 0) > (exists.views or 0):
                            exists.views = vid["views"]
                            exists.likes = vid.get("likes", 0)
                            exists.comments_count = vid.get("comments_count", 0)
                        continue

                    sentiment, score = analyzer.analyze(vid["title"])

                    session.add(YouTubeVideo(
                        tenant_id=tenant_id,
                        election_id=election_id,
                        candidate_id=cand.id,
                        video_id=vid["video_id"],
                        title=vid["title"],
                        channel=vid.get("channel", ""),
                        description_snippet=vid.get("description", "")[:300],
                        thumbnail_url=vid.get("thumbnail", ""),
                        views=vid.get("views", 0),
                        likes=vid.get("likes", 0),
                        comments_count=vid.get("comments_count", 0),
                        sentiment=sentiment,
                        sentiment_score=score,
                    ))
                    total += 1

        session.commit()
        run.status = "success"
        run.completed_at = datetime.now(timezone.utc)
        run.items_collected = total
        run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        session.commit()
        return {"status": "success", "items": total}

    except Exception as e:
        run.status = "failed"
        run.error_message = str(e)[:500]
        run.completed_at = datetime.now(timezone.utc)
        session.commit()
        raise
    finally:
        session.close()


# ──────────────── TRENDS COLLECTION ────────────────────────────

@celery_app.task(bind=True, name="collect.trends")
def collect_trends(self, tenant_id: str, election_id: str, schedule_id: str):
    """네이버 DataLab 검색 트렌드 수집."""
    from app.collectors.trends import NaverTrendCollector
    from app.elections.models import ScheduleRun, Candidate, SearchTrend

    session = get_sync_session()
    run = ScheduleRun(schedule_id=schedule_id, tenant_id=tenant_id, status="running")
    session.add(run)
    session.commit()

    try:
        candidates = session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.tenant_id == tenant_id,
                Candidate.enabled == True,
            )
        ).scalars().all()

        collector = NaverTrendCollector(
            client_id=settings.NAVER_CLIENT_ID,
            client_secret=settings.NAVER_CLIENT_SECRET,
            searchad_api_key=settings.NAVER_SEARCHAD_API_KEY,
            searchad_secret=settings.NAVER_SEARCHAD_SECRET,
            searchad_customer_id=settings.NAVER_SEARCHAD_CUSTOMER_ID,
        )

        # 후보별 대표 키워드로 상대 검색량 비교 (최대 5개)
        keywords = [c.name for c in candidates[:5]]
        now = datetime.now()
        start = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        end = now.strftime("%Y-%m-%d")

        trend_data = _run_async(collector.get_relative_trend(keywords, start, end))

        total = 0
        for kw, data_points in trend_data.items():
            if not data_points:
                continue

            latest = data_points[-1] if data_points else {}
            avg_7d = 0
            if len(data_points) >= 7:
                avg_7d = sum(d["ratio"] for d in data_points[-7:]) / 7

            session.add(SearchTrend(
                tenant_id=tenant_id,
                election_id=election_id,
                keyword=kw,
                platform="naver_datalab",
                relative_volume=latest.get("ratio", 0),
                search_volume=int(avg_7d * 100),
            ))
            total += 1

        # 검색광고 API로 월간 검색량도 수집
        volume_data = _run_async(collector.get_search_volume(keywords))
        for kw, vol in volume_data.items():
            session.add(SearchTrend(
                tenant_id=tenant_id,
                election_id=election_id,
                keyword=kw,
                platform="naver_searchad",
                search_volume=vol.get("monthly_pc", 0) + vol.get("monthly_mobile", 0),
            ))
            total += 1

        session.commit()
        run.status = "success"
        run.completed_at = datetime.now(timezone.utc)
        run.items_collected = total
        run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        session.commit()
        return {"status": "success", "items": total}

    except Exception as e:
        run.status = "failed"
        run.error_message = str(e)[:500]
        run.completed_at = datetime.now(timezone.utc)
        session.commit()
        raise
    finally:
        session.close()



# ──────────────── NEWS COMMENTS ──────────────────────────────

@celery_app.task(bind=True, name="collect.news_comments")
def collect_news_comments(self, tenant_id: str, election_id: str, schedule_id: str = None):
    """최근 뉴스 기사의 댓글 수집."""
    from app.collectors.news_comments import collect_comments_for_articles
    from app.analysis.sentiment import SentimentAnalyzer
    from app.elections.models import NewsArticle, Candidate
    from app.elections.history_models import NewsComment

    session = get_sync_session()
    try:
        # 최근 24시간 뉴스 가져오기
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

        articles = session.execute(
            select(NewsArticle, Candidate.name)
            .join(Candidate, NewsArticle.candidate_id == Candidate.id)
            .where(
                NewsArticle.tenant_id == tenant_id,
                NewsArticle.collected_at >= cutoff,
            )
            .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
            .limit(20)
        ).all()

        article_list = [
            {"url": a.url, "title": a.title, "candidate": cname}
            for a, cname in articles
        ]

        results = _run_async(collect_comments_for_articles(article_list, max_per_article=10))
        analyzer = SentimentAnalyzer()
        total = 0

        for article_result in results:
            for comment in article_result.get("comments", []):
                text = comment.get("text", "")
                if not text:
                    continue
                sentiment, _ = analyzer.analyze(text)
                session.add(NewsComment(
                    tenant_id=tenant_id,
                    article_url=article_result["url"],
                    author=comment.get("author", ""),
                    text=text[:500],
                    sympathy_count=comment.get("sympathy", 0),
                    antipathy_count=comment.get("antipathy", 0),
                    sentiment=sentiment,
                    candidate_name=article_result.get("candidate", ""),
                ))
                total += 1

        session.commit()
        return {"status": "success", "comments": total}

    except Exception as e:
        session.rollback()
        raise
    finally:
        session.close()


# ──────────────── COMMUNITY COLLECTOR (enhanced) ─────────────

@celery_app.task(bind=True, name="collect.community_enhanced")
def collect_community_enhanced(self, tenant_id: str, election_id: str, schedule_id: str):
    """커뮤니티/맘카페/블로그 수집 (enhanced collector)."""
    from app.collectors.community_collector import CommunityCollector
    from app.elections.models import ScheduleRun, Candidate, CommunityPost

    session = get_sync_session()
    run = ScheduleRun(schedule_id=schedule_id, tenant_id=tenant_id, status="running")
    session.add(run)
    session.commit()

    try:
        candidates = session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.tenant_id == tenant_id,
                Candidate.enabled == True,
            )
        ).scalars().all()

        collector = CommunityCollector(settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET)
        cand_names = [c.name for c in candidates]
        total = 0

        # 선거 유형 가져오기 (이슈 분류용)
        from app.elections.models import Election
        election = session.execute(
            select(Election).where(Election.id == election_id)
        ).scalar_one_or_none()
        e_type = election.election_type if election else None

        for cand in candidates:
            keywords = cand.search_keywords or [cand.name]
            search_keywords = []
            for kw in keywords:
                search_keywords.append(kw)
                if "교육감" not in kw:
                    search_keywords.append(f"{kw} 교육감")

            posts = _run_async(collector.collect_all(
                keywords=search_keywords,
                candidate_names=cand_names,
                max_per_keyword=8,
                election_type=e_type,
            ))

            for post in posts:
                exists = session.execute(
                    select(CommunityPost).where(
                        CommunityPost.tenant_id == tenant_id,
                        CommunityPost.url == post["url"],
                    )
                ).scalar_one_or_none()
                if exists:
                    continue

                session.add(CommunityPost(
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

        session.commit()
        run.status = "success"
        run.completed_at = datetime.now(timezone.utc)
        run.items_collected = total
        run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        session.commit()
        return {"status": "success", "items": total}

    except Exception as e:
        run.status = "failed"
        run.error_message = str(e)[:500]
        run.completed_at = datetime.now(timezone.utc)
        session.commit()
        raise
    finally:
        session.close()


# ──────────────── YOUTUBE (with Shorts + Comments) ───────────

@celery_app.task(bind=True, name="collect.youtube_enhanced")
def collect_youtube_enhanced(self, tenant_id: str, election_id: str, schedule_id: str):
    """유튜브 영상 + 숏츠 + 댓글 수집."""
    from app.collectors.youtube import YouTubeCollector
    from app.analysis.sentiment import SentimentAnalyzer
    from app.elections.models import ScheduleRun, Candidate, YouTubeVideo
    from app.elections.history_models import YouTubeComment

    session = get_sync_session()
    run = ScheduleRun(schedule_id=schedule_id, tenant_id=tenant_id, status="running")
    session.add(run)
    session.commit()

    try:
        candidates = session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.tenant_id == tenant_id,
                Candidate.enabled == True,
            )
        ).scalars().all()

        collector = YouTubeCollector(settings.YOUTUBE_API_KEY or settings.GOOGLE_API_KEY)
        analyzer = SentimentAnalyzer()
        total = 0
        comment_total = 0

        for cand in candidates:
            for keyword in (cand.search_keywords or [cand.name]):
                # Regular videos
                videos = _run_async(collector.search_videos(keyword, max_results=10))
                # Shorts
                shorts = _run_async(collector.search_shorts(keyword, max_results=5))

                for vid in videos + shorts:
                    exists = session.execute(
                        select(YouTubeVideo).where(
                            YouTubeVideo.tenant_id == tenant_id,
                            YouTubeVideo.video_id == vid["video_id"],
                        )
                    ).scalar_one_or_none()

                    if exists:
                        if vid.get("views", 0) > (exists.views or 0):
                            exists.views = vid["views"]
                            exists.likes = vid.get("likes", 0)
                            exists.comments_count = vid.get("comments_count", 0)
                        continue

                    sentiment, score = analyzer.analyze(vid["title"])
                    session.add(YouTubeVideo(
                        tenant_id=tenant_id,
                        election_id=election_id,
                        candidate_id=cand.id,
                        video_id=vid["video_id"],
                        title=vid["title"],
                        channel=vid.get("channel", ""),
                        description_snippet=vid.get("description", "")[:300],
                        thumbnail_url=vid.get("thumbnail", ""),
                        views=vid.get("views", 0),
                        likes=vid.get("likes", 0),
                        comments_count=vid.get("comments_count", 0),
                        sentiment=sentiment,
                        sentiment_score=score,
                    ))
                    total += 1

            # Comments for top videos
            top_vids = session.execute(
                select(YouTubeVideo).where(
                    YouTubeVideo.candidate_id == cand.id,
                    YouTubeVideo.tenant_id == tenant_id,
                )
                .order_by(YouTubeVideo.views.desc()).limit(3)
            ).scalars().all()

            for v in top_vids:
                comments = _run_async(collector.get_video_comments(v.video_id, max_results=10))
                for c in comments:
                    sentiment, _ = analyzer.analyze(c.get("text", ""))
                    session.add(YouTubeComment(
                        tenant_id=tenant_id,
                        video_id=v.video_id,
                        author=c.get("author", ""),
                        text=c.get("text", "")[:500],
                        like_count=c.get("likes", 0),
                        sentiment=sentiment,
                        candidate_name=cand.name,
                    ))
                    comment_total += 1

        session.commit()
        run.status = "success"
        run.completed_at = datetime.now(timezone.utc)
        run.items_collected = total
        run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        session.commit()
        return {"status": "success", "videos": total, "comments": comment_total}

    except Exception as e:
        run.status = "failed"
        run.error_message = str(e)[:500]
        run.completed_at = datetime.now(timezone.utc)
        session.commit()
        raise
    finally:
        session.close()


# ──────────────── FULL COLLECTION ──────────────────────────────

@celery_app.task(bind=True, name="collect.full_collection")
def full_collection(self, tenant_id: str, election_id: str):
    """
    전체 수집 (뉴스 + 커뮤니티 + 유튜브 + 트렌드 + 댓글).
    06:00, 13:00, 17:00 에 실행.
    """
    from app.elections.models import ScheduleConfig

    session = get_sync_session()
    try:
        # Find or create a dummy schedule_id for tracking
        schedule = session.execute(
            select(ScheduleConfig).where(
                ScheduleConfig.election_id == election_id,
                ScheduleConfig.tenant_id == tenant_id,
                ScheduleConfig.schedule_type == "full_collection",
                ScheduleConfig.enabled == True,
            )
        ).scalar_one_or_none()

        schedule_id = str(schedule.id) if schedule else None

        results = {}

        # News
        try:
            if schedule_id:
                r = collect_news.apply(args=[tenant_id, election_id, schedule_id])
                results["news"] = r.result if r.result else {"status": "ok"}
            else:
                results["news"] = {"status": "no_schedule"}
        except Exception as e:
            results["news"] = {"status": "error", "error": str(e)[:200]}

        # Community
        try:
            if schedule_id:
                r = collect_community_enhanced.apply(args=[tenant_id, election_id, schedule_id])
                results["community"] = r.result if r.result else {"status": "ok"}
            else:
                results["community"] = {"status": "no_schedule"}
        except Exception as e:
            results["community"] = {"status": "error", "error": str(e)[:200]}

        # YouTube
        try:
            if schedule_id:
                r = collect_youtube_enhanced.apply(args=[tenant_id, election_id, schedule_id])
                results["youtube"] = r.result if r.result else {"status": "ok"}
            else:
                results["youtube"] = {"status": "no_schedule"}
        except Exception as e:
            results["youtube"] = {"status": "error", "error": str(e)[:200]}

        # Trends
        try:
            if schedule_id:
                r = collect_trends.apply(args=[tenant_id, election_id, schedule_id])
                results["trends"] = r.result if r.result else {"status": "ok"}
            else:
                results["trends"] = {"status": "no_schedule"}
        except Exception as e:
            results["trends"] = {"status": "error", "error": str(e)[:200]}

        # News comments
        try:
            r = collect_news_comments.apply(args=[tenant_id, election_id])
            results["comments"] = r.result if r.result else {"status": "ok"}
        except Exception as e:
            results["comments"] = {"status": "error", "error": str(e)[:200]}

        logger.info("full_collection_done", tenant_id=tenant_id, results=results)
        return {"status": "success", "results": results}

    except Exception as e:
        logger.error("full_collection_error", error=str(e))
        return {"status": "error", "error": str(e)[:500]}
    finally:
        session.close()


# ──────────────── ALERT MONITOR ──────────────────────────────

@celery_app.task(bind=True, name="collect.alert_check")
def alert_check(self, tenant_id: str, election_id: str):
    """위기 감지 체크 (30분마다 실행)."""
    from app.collectors.alert_monitor import AlertMonitor, format_alert_message
    from app.elections.models import Candidate, Election

    session = get_sync_session()
    try:
        candidates = session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.tenant_id == tenant_id,
                Candidate.enabled == True,
            )
        ).scalars().all()

        election = session.execute(
            select(Election).where(Election.id == election_id)
        ).scalar_one_or_none()

        cand_names = [c.name for c in candidates]
        our_cand = next((c.name for c in candidates if c.is_our_candidate), "")

        monitor = AlertMonitor(settings.REDIS_URL)
        alerts = _run_async(monitor.check_alerts(
            tenant_id=tenant_id,
            candidate_names=cand_names,
            our_candidate=our_cand,
        ))
        _run_async(monitor.close())

        if alerts:
            # Format and send via Telegram
            message = format_alert_message(alerts)
            if message:
                _send_alert_via_telegram(session, tenant_id, message)

        return {"status": "success", "alerts": len(alerts)}

    except Exception as e:
        import traceback
        logger.error("alert_check_error", error=str(e), traceback=traceback.format_exc())
        return {"status": "error", "error": str(e)}
    finally:
        session.close()


def _send_alert_via_telegram(session, tenant_id: str, message: str):
    """텔레그램으로 알림 발송 (sync context)."""
    from app.elections.models import TelegramConfig, TelegramRecipient
    from app.telegram_service.bot import TelegramBot

    config = session.execute(
        select(TelegramConfig).where(
            TelegramConfig.tenant_id == tenant_id,
            TelegramConfig.is_active == True,
        )
    ).scalar_one_or_none()

    if not config:
        return

    recipients = session.execute(
        select(TelegramRecipient).where(
            TelegramRecipient.config_id == config.id,
            TelegramRecipient.is_active == True,
            TelegramRecipient.receive_alert == True,
        )
    ).scalars().all()

    for r in recipients:
        bot = TelegramBot(config.bot_token, r.chat_id)
        _run_async(bot.send_message(message))


# ──────────────── BRIEFING TASKS ─────────────────────────────

@celery_app.task(bind=True, name="briefing.morning")
def morning_briefing(self, tenant_id: str, election_id: str):
    """
    오전 브리핑 (08:00): 전체 수집 후 AI 분석 → 텔레그램 발송.
    """
    return _run_briefing(tenant_id, election_id, "morning")


@celery_app.task(bind=True, name="collect.full_with_briefing")
def full_collection_with_briefing(self, tenant_id: str, election_id: str, briefing_type: str = "daily"):
    """
    수집 + AI 분석 + 브리핑 한 번에 (수집 직후 즉시 보고서 생성).
    스케줄러에서 호출 — full_with_briefing 타입.
    """
    # 1. 수집 (동기 호출)
    collect_result = full_collection(tenant_id, election_id) if not hasattr(full_collection, 'delay') else full_collection.run(tenant_id, election_id)

    # 2. 수집 직후 브리핑
    briefing_result = _run_briefing(tenant_id, election_id, briefing_type)

    return {
        "collected": collect_result if isinstance(collect_result, dict) else {},
        "briefing": briefing_result,
    }


@celery_app.task(bind=True, name="briefing.afternoon")
def afternoon_briefing(self, tenant_id: str, election_id: str):
    """
    오후 브리핑 (14:00): 전체 수집 후 AI 분석 → 텔레그램 발송.
    """
    return _run_briefing(tenant_id, election_id, "afternoon")


@celery_app.task(bind=True, name="briefing.daily")
def daily_report(self, tenant_id: str, election_id: str):
    """
    일일 보고서 (18:00): 전체 수집 후 AI 분석 → 텔레그램 발송.
    """
    return _run_briefing(tenant_id, election_id, "daily")


def _run_briefing(tenant_id: str, election_id: str, briefing_type: str) -> dict:
    """브리핑 공통 로직: AI 보고서 생성 → DB 저장 → 텔레그램 발송."""
    import uuid as uuid_mod
    from app.elections.models import Report

    session = get_sync_session()
    try:
        # 1. AI 보고서 생성 시도
        report_text = ""
        ai_generated = False

        try:
            # generate_ai_report is async — run it
            result = _run_async(_generate_report_async(tenant_id, election_id))
            report_text = result.get("text", "")
            ai_generated = result.get("ai_generated", False)
        except Exception as e:
            logger.warning("briefing_ai_error", error=str(e), type=briefing_type)

        # 2. AI 실패시 데이터 기반 보고서 (via telegram reporter)
        if not report_text:
            try:
                report_text = _run_async(
                    _generate_briefing_text(tenant_id, election_id, briefing_type)
                )
            except Exception as e:
                logger.error("briefing_fallback_error", error=str(e))
                report_text = f"보고서 생성 실패: {str(e)[:200]}"

        # 3. DB 저장
        type_map = {
            "morning": "morning_brief",
            "afternoon": "afternoon_brief",
            "daily": "daily",
        }
        report = Report(
            id=uuid_mod.uuid4(),
            tenant_id=tenant_id,
            election_id=election_id,
            report_type=type_map.get(briefing_type, briefing_type),
            title=report_text.split("\n")[0] if report_text else f"{briefing_type} 보고서",
            content_text=report_text,
            report_date=date.today(),
            sent_via_telegram=False,
        )
        session.add(report)
        session.commit()

        # 4. 텔레그램 발송
        sent = 0
        try:
            sent = _run_async(
                _send_briefing_telegram(tenant_id, report_text, briefing_type)
            )
            if sent > 0:
                report.sent_via_telegram = True
                report.sent_at = datetime.now(timezone.utc)
                session.commit()
        except Exception as e:
            logger.error("briefing_telegram_error", error=str(e))

        logger.info(
            "briefing_complete",
            type=briefing_type,
            tenant_id=tenant_id,
            ai=ai_generated,
            telegram_sent=sent,
        )

        return {
            "status": "success",
            "briefing_type": briefing_type,
            "ai_generated": ai_generated,
            "telegram_sent": sent,
            "report_id": str(report.id),
        }

    except Exception as e:
        logger.error("briefing_error", error=str(e), type=briefing_type)
        return {"status": "error", "error": str(e)[:500]}
    finally:
        session.close()


async def _generate_report_async(tenant_id: str, election_id: str) -> dict:
    """AI 보고서 생성 (async context)."""
    from app.database import async_session_factory
    from app.reports.ai_report import generate_ai_report

    async with async_session_factory() as db:
        return await generate_ai_report(db, tenant_id, election_id)


async def _generate_briefing_text(
    tenant_id: str, election_id: str, briefing_type: str,
) -> str:
    """브리핑 텍스트 생성 (async context, 텔레그램 발송 없음)."""
    from app.database import async_session_factory
    from app.telegram_service.reporter import generate_briefing_text

    async with async_session_factory() as db:
        text = await generate_briefing_text(db, tenant_id, election_id, briefing_type)
        return text or ""


async def _send_briefing_telegram(
    tenant_id: str, text: str, briefing_type: str,
) -> int:
    """텔레그램 발송 (async context)."""
    from app.database import async_session_factory
    from app.telegram_service.reporter import _send_to_all_recipients

    async with async_session_factory() as db:
        return await _send_to_all_recipients(db, tenant_id, text, "briefing")


# ──────────────── SCHEDULER ────────────────────────────────────

@celery_app.task(name="scheduler.check_and_run")
def check_and_run_schedules():
    """
    1분마다 실행: 모든 테넌트의 스케줄 확인 및 실행.

    Schedule workflow (KST):
      06:00  Full collection (news + community + youtube + trends + comments)
      08:00  AI analysis → Morning briefing → Telegram
      08:30~13:00  Alert check every 30 min (lightweight)
      13:00  Full collection
      14:00  AI analysis → Afternoon briefing → Telegram
      14:30~17:00  Alert check continues
      17:00  Full collection
      18:00  AI analysis → Daily report → Telegram
      18:00~06:00  No collection (server idle)
    """
    from app.elections.models import ScheduleConfig
    from app.auth.models import Tenant

    session = get_sync_session()
    try:
        now = datetime.now(KST)
        current_time = now.strftime("%H:%M")
        current_hour = now.hour

        # 운영 시간 체크 (06:00~19:00 KST)
        if current_hour < 6 or current_hour >= 19:
            return {"message": "Off hours", "time": current_time}

        schedules = session.execute(
            select(ScheduleConfig, Tenant)
            .join(Tenant, ScheduleConfig.tenant_id == Tenant.id)
            .where(ScheduleConfig.enabled == True, Tenant.is_active == True)
        ).all()

        triggered = 0

        # Task dispatch map
        collection_task_map = {
            "news": collect_news,
            "community": collect_community_enhanced,
            "youtube": collect_youtube_enhanced,
            "trends": collect_trends,
        }

        briefing_task_map = {
            "morning": morning_briefing,
            "afternoon": afternoon_briefing,
            "daily": daily_report,
        }

        for schedule, tenant in schedules:
            if current_time not in (schedule.fixed_times or []):
                continue

            stype = schedule.schedule_type
            config = schedule.config or {}
            tid = str(schedule.tenant_id)
            eid = str(schedule.election_id)
            sid = str(schedule.id)

            if stype == "full_collection":
                # Full collection: news + community + youtube + trends + comments
                full_collection.delay(tid, eid)
                triggered += 1

            elif stype == "full_with_briefing":
                # 수집 + AI 분석 + 보고서 + 텔레그램 한번에
                full_collection_with_briefing.delay(tid, eid, config.get("briefing_type", "daily"))
                triggered += 1

            elif stype == "briefing":
                # Briefing: generate report + send telegram
                bt = config.get("briefing_type", "daily")
                task_fn = briefing_task_map.get(bt, daily_report)
                task_fn.delay(tid, eid)
                triggered += 1

            elif stype in collection_task_map:
                # Individual collection type
                task_fn = collection_task_map[stype]
                task_fn.delay(tid, eid, sid)
                triggered += 1

        return {"time": current_time, "checked": len(schedules), "triggered": triggered}
    finally:
        session.close()


# ──────────────── CELERY BEAT SCHEDULE ────────────────────────

celery_app.conf.beat_schedule = {
    "check-schedules-every-minute": {
        "task": "scheduler.check_and_run",
        "schedule": 60.0,
    },
    "alert-check-every-30-minutes": {
        "task": "collect.alert_check_all",
        "schedule": 1800.0,  # 30 minutes
    },
}


@celery_app.task(name="collect.alert_check_all")
def alert_check_all_tenants():
    """
    모든 활성 테넌트에 대해 위기 감지 실행.
    08:00~18:00 KST 사이에만 실행.
    """
    from app.elections.models import Election
    from app.auth.models import Tenant

    session = get_sync_session()
    try:
        now = datetime.now(KST)
        if now.hour < 8 or now.hour >= 18:
            return {"message": "Alert check off hours (08:00-18:00 KST only)"}

        # 활성 테넌트 + 선거 조회
        elections = session.execute(
            select(Election, Tenant)
            .join(Tenant, Election.tenant_id == Tenant.id)
            .where(Election.is_active == True, Tenant.is_active == True)
        ).all()

        triggered = 0
        for election, tenant in elections:
            alert_check.delay(str(tenant.id), str(election.id))
            triggered += 1

        return {"triggered": triggered, "time": now.strftime("%H:%M")}
    finally:
        session.close()
