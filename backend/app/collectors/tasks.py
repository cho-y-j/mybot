"""
ElectionPulse - Celery Collection Tasks
기존 프로토타입의 검증된 수집 로직을 비동기 태스크로 통합
"""
import asyncio
from datetime import datetime, timezone, timedelta
from uuid import UUID

from celery import Celery
from sqlalchemy import select, create_engine
from sqlalchemy.orm import Session

from app.config import get_settings
import structlog

logger = structlog.get_logger()
settings = get_settings()

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
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

        articles = session.execute(
            select(NewsArticle, Candidate.name)
            .join(Candidate, NewsArticle.candidate_id == Candidate.id)
            .where(
                NewsArticle.tenant_id == tenant_id,
                NewsArticle.collected_at >= cutoff,
            )
            .order_by(NewsArticle.collected_at.desc())
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


# ──────────────── SCHEDULER ────────────────────────────────────

@celery_app.task(name="scheduler.check_and_run")
def check_and_run_schedules():
    """1분마다 실행: 모든 테넌트의 스케줄 확인 및 실행."""
    from app.elections.models import ScheduleConfig
    from app.auth.models import Tenant

    session = get_sync_session()
    try:
        now = datetime.now(timezone(timedelta(hours=9)))  # KST
        current_time = now.strftime("%H:%M")
        current_hour = now.hour

        # 운영 시간 체크 (09:00~20:00)
        if current_hour < 9 or current_hour >= 20:
            return {"message": "Off hours", "time": current_time}

        schedules = session.execute(
            select(ScheduleConfig, Tenant)
            .join(Tenant, ScheduleConfig.tenant_id == Tenant.id)
            .where(ScheduleConfig.enabled == True, Tenant.is_active == True)
        ).all()

        triggered = 0
        task_map = {
            "news": collect_news,
            "community": collect_community_enhanced,
            "youtube": collect_youtube_enhanced,
            "trends": collect_trends,
        }

        for schedule, tenant in schedules:
            if current_time in (schedule.fixed_times or []):
                task_fn = task_map.get(schedule.schedule_type)
                if task_fn:
                    task_fn.delay(
                        str(schedule.tenant_id),
                        str(schedule.election_id),
                        str(schedule.id),
                    )
                    triggered += 1

        return {"time": current_time, "checked": len(schedules), "triggered": triggered}
    finally:
        session.close()


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
    08:00~18:00 사이에만 실행.
    """
    from app.elections.models import Election
    from app.auth.models import Tenant

    session = get_sync_session()
    try:
        now = datetime.now(timezone(timedelta(hours=9)))
        if now.hour < 8 or now.hour >= 18:
            return {"message": "Alert check off hours"}

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
