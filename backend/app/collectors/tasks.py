"""
ElectionPulse - Celery Collection Tasks
기존 프로토타입의 검증된 수집 로직을 비동기 태스크로 통합
"""
import asyncio
import os
from datetime import datetime, timezone, timedelta, date
from uuid import UUID

from celery import Celery
from sqlalchemy import select, create_engine, func, text
from sqlalchemy.orm import Session

from app.config import get_settings
import structlog

# ORM 모델 사전 로드 (relationship 해소)
import app.auth.models  # noqa: F401 — Tenant, AIAccount 등
import app.elections.models  # noqa: F401

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
    task_time_limit=1800,
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
        if loop.is_closed():
            return asyncio.run(coro)
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


# ── 날짜 컷오프 ──
RECENT_DAYS = 7


def _check_pub_cutoff(pub_at, collected_fallback: datetime | None = None) -> tuple[datetime | None, bool]:
    """날짜 컷오프 + 저장값 결정. CLAUDE.md 룰: 가짜 날짜 저장 금지.

    Returns:
        (pub_to_save, should_keep)
        - pub_to_save: DB에 저장할 published_at. pub_at이 None이면 None (가짜 금지).
        - should_keep: True이면 해당 아이템 저장, False면 드롭 (7일 이전 또는 날짜 불명).

    필터 판정은 pub_at 우선, 없으면 collected_fallback 참고.
    저장은 실제 pub_at만 (collected_at으로 대체 금지).
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=RECENT_DAYS)

    if pub_at is not None:
        if pub_at.tzinfo is None:
            pub_at = pub_at.replace(tzinfo=timezone.utc)
        if pub_at < cutoff:
            return None, False  # 7일 이전 → 드롭
        return pub_at, True  # 실제 날짜 저장

    # pub_at 없음 — collected_at으로 recency만 판정
    if collected_fallback is None:
        return None, False
    if collected_fallback.tzinfo is None:
        collected_fallback = collected_fallback.replace(tzinfo=timezone.utc)
    if collected_fallback < cutoff:
        return None, False
    # 최근에 수집됐지만 진짜 pub_at 없음 → NULL로 저장 (정직하게)
    return None, True


def _check_recent_collection(session, election_id: str, media_type: str, within_minutes: int = 60) -> dict | None:
    """같은 election에서 최근 N분 내에 다른 캠프가 이미 수집했는지 확인.

    Returns: {"tenant_id": ..., "items": ..., "minutes_ago": ...} 또는 None
    """
    from app.elections.models import ScheduleRun, ScheduleConfig
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=within_minutes)

    # ScheduleConfig와 JOIN해서 같은 election + 같은 media_type의 최근 성공 실행 찾기
    rows = session.execute(
        select(ScheduleRun, ScheduleConfig.tenant_id).join(
            ScheduleConfig, ScheduleRun.schedule_id == ScheduleConfig.id
        ).where(
            ScheduleRun.status == "success",
            ScheduleRun.completed_at >= cutoff,
            ScheduleConfig.election_id == election_id,
            ScheduleConfig.schedule_type == media_type,
        ).order_by(ScheduleRun.completed_at.desc()).limit(1)
    ).first()

    if rows:
        run, config_tenant_id = rows
        mins = (datetime.now(timezone.utc) - run.completed_at).total_seconds() / 60
        return {
            "tenant_id": str(config_tenant_id),
            "items": run.items_collected or 0,
            "minutes_ago": round(mins, 1),
        }
    return None


# 하위 호환: 기존 함수명 유지하되 새 함수로 래핑
def _is_recent_or_fallback(pub_at, collected_fallback: datetime | None = None) -> datetime | None:
    """DEPRECATED: _check_pub_cutoff 사용 권장."""
    _, keep = _check_pub_cutoff(pub_at, collected_fallback)
    return pub_at if keep else None


async def _run_full_ai_pipeline(tenant_id: str, election_id: str, limit_per_type: int = 100) -> dict:
    """수집 직후 호출: Sonnet 전략 분석 + Opus 검증 + 이벤트 기반 위기 알림.

    AsyncSession을 열어 analyze_all_media(내부에서 Opus 검증까지 포함)를 실행하고,
    끝난 직후 AI가 판정한 weakness/threat 항목을 실시간 텔레그램 알림으로 발송.
    """
    from app.database import async_session_factory
    from app.analysis.media_analyzer import analyze_all_media
    from app.collectors.alert_monitor import check_db_alerts, format_alert_message

    async with async_session_factory() as adb:
        try:
            # 미분석 데이터가 남지 않을 때까지 루프 (최대 10회 = 1000건)
            # LIMIT 100에 밀려 영영 분석되지 않던 문제 해결
            result = {"iterations": 0, "total_analyzed": 0}
            for _ in range(10):
                iter_result = await analyze_all_media(
                    adb, tenant_id, election_id, limit_per_type=limit_per_type,
                )
                await adb.commit()
                this_analyzed = iter_result.get("total_analyzed", 0)
                result["iterations"] += 1
                result["total_analyzed"] += this_analyzed
                result.update({k: v for k, v in iter_result.items() if k != "total_analyzed"})
                if this_analyzed == 0:
                    break  # 미분석 없음 → 종료
        except Exception as e:
            try:
                await adb.rollback()
            except Exception:
                pass  # 연결 실패 시 rollback도 실패할 수 있음
            logger.error("ai_pipeline_failed", error=str(e)[:300],
                         tenant=tenant_id, election=election_id)
            return {"error": str(e)[:300]}

        # ── RAG 벡터 임베딩 (분석 완료된 데이터) ──
        try:
            from app.services.embedding_service import embed_existing_data
            emb_result = await embed_existing_data(adb, tenant_id, election_id)
            result["embeddings"] = emb_result
            logger.info("auto_embedding_done", tenant=tenant_id, result=emb_result)
        except Exception as emb_err:
            logger.warning("auto_embedding_error", error=str(emb_err)[:200])

        # ── 이벤트 기반 긴급 알림 ──
        try:
            alerts = await check_db_alerts(adb, tenant_id, election_id, since_minutes=30)
            if alerts:
                msg = format_alert_message(alerts)
                from app.telegram_service.reporter import send_alert
                await send_alert(adb, tenant_id, msg)
                result["alerts_sent"] = len(alerts)
                logger.info("pipeline_alerts_sent", count=len(alerts), tenant=tenant_id)
            else:
                result["alerts_sent"] = 0
        except Exception as alert_err:
            logger.warning("pipeline_alert_error", error=str(alert_err)[:300])
            result["alerts_sent"] = 0

        return result


# ──────────────── NEWS COLLECTION ──────────────────────────────

@celery_app.task(bind=True, name="collect.news")
def collect_news(self, tenant_id: str, election_id: str, schedule_id: str):
    """뉴스 수집: 후보별 키워드로 검색 → 수집 시점 게이트 → 저장 → AI 파이프라인.

    CLAUDE.md 룰 1.7: 날짜 컷오프 (7일), 관련성 필터, AI가 아닌 폴백 감성 금지.
    CLAUDE.md 룰 1.6: 수집 직후 Sonnet 분석 + Opus 검증이 한 흐름으로 실행됨.
    """
    from app.collectors.naver import NaverCollector
    from app.collectors.filters import parse_published_at
    from app.elections.models import ScheduleRun, Candidate, NewsArticle

    session = get_sync_session()
    run = ScheduleRun(schedule_id=schedule_id, tenant_id=tenant_id, status="running")
    session.add(run)
    session.commit()

    try:
        # ── 같은 election에서 최근 수집이 있으면 수집 스킵, AI 분석만 실행 ──
        recent = _check_recent_collection(session, election_id, "news", within_minutes=60)
        if recent and recent["tenant_id"] != tenant_id:
            logger.info("news_skip_recent_exists",
                        tenant=tenant_id, other_tenant=recent["tenant_id"],
                        minutes_ago=recent["minutes_ago"], items=recent["items"])
            # 수집 스킵 → 캠프별 AI 분석(관점)만 실행
            ai_result = {}
            try:
                ai_result = _run_async(_run_full_ai_pipeline(tenant_id, election_id))
            except Exception as ai_err:
                logger.error("news_skip_ai_error", error=str(ai_err)[:200])
            run.status = "success"
            run.completed_at = datetime.now(timezone.utc)
            run.items_collected = 0
            run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
            session.commit()
            return {"status": "skipped_recent", "items": 0, "ai": ai_result,
                    "reason": f"다른 캠프가 {recent['minutes_ago']}분 전 수집 완료"}

        candidates = session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.enabled == True,
            )
        ).scalars().all()
        # election-shared: is_our_candidate 을 tenant_elections 기준으로 덮어씀
        _our_cand_id = session.execute(text(
            "SELECT our_candidate_id FROM tenant_elections "
            "WHERE tenant_id = :tid AND election_id = :eid AND our_candidate_id IS NOT NULL"
        ), {"tid": str(tenant_id), "eid": str(election_id)}).scalar()
        for _c in candidates:
            _c.is_our_candidate = bool(_our_cand_id and str(_c.id) == str(_our_cand_id))

        collector = NaverCollector(settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET, settings.NAVER_CLIENT_ID_2, settings.NAVER_CLIENT_SECRET_2)
        cand_names = [c.name for c in candidates]
        our_cand = next((c for c in candidates if c.is_our_candidate), None)
        rival_names = [c.name for c in candidates if not c.is_our_candidate]
        total = 0
        dropped_old = 0
        raw_items = []

        from app.elections.models import Election as _Election
        from app.elections.korea_data import ELECTION_ISSUES, REGIONS
        election = session.execute(select(_Election).where(_Election.id == election_id)).scalar_one_or_none()
        etype = election.election_type if election else "mayor"
        _raw_label = ELECTION_ISSUES.get(etype, {}).get("label", "후보")
        type_label = _raw_label.split("(")[0].strip().split(" ")[0]
        region_short = REGIONS.get(election.region_sido, {}).get("short", "") if election and election.region_sido else ""

        # keyword 단위 dedup — 여러 후보가 같은 키워드 등록 시 1회만 API 호출
        kw_plans: dict[str, object] = {}
        for cand in candidates:
            for keyword in (cand.search_keywords or [cand.name]):
                kw_plans.setdefault(keyword, cand)

        seen_urls: set[str] = set()
        for keyword, primary_cand in kw_plans.items():
            homonym = None
            if primary_cand.homonym_filters:
                homonym = {
                    "exclude": primary_cand.homonym_filters,
                    "require_any": ["선거", "후보", "공약", "출마", type_label, region_short],
                }
            articles = _run_async(
                collector.search_news(keyword, display=15, homonym_filters=homonym)
            )

            for article in articles:
                title = article.get("title", "")
                desc = article.get("description", "")
                full_text = f"{title} {desc}"
                url = article.get("url", "")

                if url in seen_urls:
                    continue

                # 실제 매칭 후보 찾기 (본문에 이름 포함)
                matched_cand = next((c for c in candidates if c.name in full_text), None)
                if matched_cand is None:
                    continue
                if any(x in title for x in [
                    "멤버십", "무료배송", "스토어", "할인", "쿠폰",
                    "적립", "클립 챌린지", "24시간 센터",
                ]):
                    continue

                pub_at_raw = parse_published_at(
                    article.get("pub_date") or article.get("pubDate")
                )
                pub_at, should_keep = _check_pub_cutoff(pub_at_raw, datetime.now(timezone.utc))
                if not should_keep:
                    dropped_old += 1
                    continue

                # 중복 체크 (election-shared)
                exists = session.execute(
                    select(NewsArticle).where(
                        NewsArticle.election_id == election_id,
                        NewsArticle.url == url,
                    )
                ).scalar_one_or_none()
                if exists:
                    continue

                seen_urls.add(url)
                raw_items.append({
                    "id": url,
                    "title": title,
                    "description": desc[:500],
                    "url": url,
                    "source": article.get("source", ""),
                    "published_at": pub_at,
                    "platform": article.get("platform", "naver"),
                    "candidate_id": str(matched_cand.id),
                    "candidate_name": matched_cand.name,
                })

        # ── AI 스크리닝 (동명이인 필터 + 감성/전략 분석) ──
        filtered_out = 0
        if raw_items:
            try:
                from app.collectors.ai_screening import screen_collected_items
                all_hints = []
                for c in candidates:
                    all_hints.extend(c.homonym_filters or [])
                screened = _run_async(screen_collected_items(
                    items=raw_items,
                    our_candidate_name=our_cand.name if our_cand else candidates[0].name,
                    rival_candidate_names=rival_names,
                    election_type=type_label,
                    region=f"{election.region_sido or ''} {election.region_sigungu or ''}".strip() if election else "",
                    homonym_hints=list(set(all_hints)),
                    tenant_id=tenant_id,
                ))
                filtered_out = len(raw_items) - len(screened)
            except Exception as scr_err:
                logger.error("news_ai_screening_failed", error=str(scr_err)[:200])
                screened = raw_items

            from sqlalchemy.dialects.postgresql import insert as pg_insert
            from app.analysis.strategic_views import upsert_strategic_view_sync
            for item in screened:
                ai_ok = item.get("ai_screened", False)
                stmt = pg_insert(NewsArticle).values(
                    tenant_id=tenant_id, election_id=election_id,
                    candidate_id=UUID(item["candidate_id"]),
                    title=item["title"], url=item["url"],
                    source=item.get("source", ""), summary=item.get("description", "")[:300],
                    published_at=item.get("published_at"),
                    platform=item.get("platform", "naver"),
                    is_relevant=True,
                    sentiment=item.get("sentiment") if ai_ok else None,
                    sentiment_score=item.get("sentiment_score") if ai_ok else None,
                    ai_summary=item.get("ai_summary") if ai_ok else None,
                    ai_reason=item.get("ai_reason") if ai_ok else None,
                    ai_threat_level=item.get("threat_level") if ai_ok else None,
                ).on_conflict_do_nothing(constraint="uq_news_url_per_election")
                res = session.execute(stmt)
                if res.rowcount:
                    total += 1

                # 전략 뷰 (캠프별 관점) upsert — 수집한 캠프 한 명만
                if ai_ok:
                    row = session.execute(
                        select(NewsArticle.id).where(
                            NewsArticle.election_id == election_id,
                            NewsArticle.url == item["url"],
                        )
                    ).scalar()
                    if row:
                        upsert_strategic_view_sync(
                            session, "news",
                            source_id=row,
                            tenant_id=tenant_id,
                            election_id=election_id,
                            candidate_id=UUID(item["candidate_id"]),
                            strategic_quadrant=item.get("strategic_quadrant"),
                            strategic_value=item.get("strategic_value") or item.get("strategic_quadrant"),
                            action_type=item.get("action_type"),
                            action_priority=item.get("action_priority"),
                            action_summary=item.get("action_summary"),
                            is_about_our_candidate=item.get("is_about_our_candidate"),
                        )

                try:
                    from app.collectors.race_shared import upsert_race_news_sync
                    upsert_race_news_sync(
                        session, election_id=str(election_id),
                        title=item["title"], url=item["url"],
                        source=item.get("source", ""), summary=item.get("description", "")[:300],
                        platform=item.get("platform", "naver"), published_at=item.get("published_at"),
                    )
                except Exception as rs_err:
                    logger.warning("race_shared_dual_write_failed", error=str(rs_err)[:200])

        session.commit()

        # ── AI 파이프라인 (스크리닝에서 미분석된 항목 보완 + Opus 검증) ──
        ai_result = {}
        if total > 0:
            try:
                ai_result = _run_async(_run_full_ai_pipeline(tenant_id, election_id))
                logger.info("news_ai_pipeline_done", total=total,
                            filtered=filtered_out, ai=ai_result, dropped_old=dropped_old)
            except Exception as ai_err:
                logger.error("news_ai_pipeline_error", error=str(ai_err)[:300])

        # 실행 기록 업데이트
        run.status = "success"
        run.completed_at = datetime.now(timezone.utc)
        run.items_collected = total
        run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        session.commit()

        return {
            "status": "success",
            "items": total,
            "dropped_old": dropped_old,
            "ai": ai_result,
        }

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
    """블로그/카페 수집 → 날짜 컷오프 → 저장 → AI 파이프라인."""
    from app.collectors.naver import NaverCollector, calculate_relevance
    from app.collectors.filters import parse_published_at
    from app.elections.models import ScheduleRun, Candidate, CommunityPost

    session = get_sync_session()
    run = ScheduleRun(schedule_id=schedule_id, tenant_id=tenant_id, status="running")
    session.add(run)
    session.commit()

    try:
        # ── 같은 election에서 최근 수집이 있으면 스킵 ──
        recent = _check_recent_collection(session, election_id, "community", within_minutes=60)
        if recent and recent["tenant_id"] != tenant_id:
            logger.info("community_skip_recent_exists",
                        tenant=tenant_id, other_tenant=recent["tenant_id"],
                        minutes_ago=recent["minutes_ago"])
            ai_result = {}
            try:
                ai_result = _run_async(_run_full_ai_pipeline(tenant_id, election_id))
            except Exception:
                pass
            run.status = "success"
            run.completed_at = datetime.now(timezone.utc)
            run.items_collected = 0
            run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
            session.commit()
            return {"status": "skipped_recent", "items": 0, "ai": ai_result}

        candidates = session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.enabled == True,
            )
        ).scalars().all()
        # election-shared: is_our_candidate 을 tenant_elections 기준으로 덮어씀
        _our_cand_id = session.execute(text(
            "SELECT our_candidate_id FROM tenant_elections "
            "WHERE tenant_id = :tid AND election_id = :eid AND our_candidate_id IS NOT NULL"
        ), {"tid": str(tenant_id), "eid": str(election_id)}).scalar()
        for _c in candidates:
            _c.is_our_candidate = bool(_our_cand_id and str(_c.id) == str(_our_cand_id))

        collector = NaverCollector(settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET, settings.NAVER_CLIENT_ID_2, settings.NAVER_CLIENT_SECRET_2)
        cand_names = [c.name for c in candidates]
        our_cand = next((c for c in candidates if c.is_our_candidate), None)
        rival_names = [c.name for c in candidates if not c.is_our_candidate]
        total = 0
        dropped_old = 0
        raw_items = []

        from app.elections.models import Election as _Election
        from app.elections.korea_data import ELECTION_ISSUES, REGIONS
        election = session.execute(select(_Election).where(_Election.id == election_id)).scalar_one_or_none()
        etype = election.election_type if election else "mayor"
        _raw_label = ELECTION_ISSUES.get(etype, {}).get("label", "후보")
        type_label = _raw_label.split("(")[0].strip().split(" ")[0]

        # keyword 단위 dedup + blog/cafe 병렬 fetch
        kw_set: list[str] = []
        for cand in candidates:
            for keyword in (cand.search_keywords or [cand.name]):
                if keyword not in kw_set:
                    kw_set.append(keyword)

        async def _fetch_both(kw: str):
            return await asyncio.gather(
                collector.search_blog(kw, display=10),
                collector.search_cafe(kw, display=10),
            )

        seen_urls: set[str] = set()
        for keyword in kw_set:
            blog_posts, cafe_posts = _run_async(_fetch_both(keyword))

            for post in blog_posts + cafe_posts:
                post_text = f"{post['title']} {post.get('description', '')}"
                url = post.get("url", "")
                if url in seen_urls:
                    continue

                matched_cand = next((c for c in candidates if c.name in post_text), None)
                if matched_cand is None:
                    continue

                raw_pd = post.get("postdate") or post.get("pub_date") or post.get("pubDate")
                post_pub_raw = parse_published_at(raw_pd)
                post_pub_at, should_keep = _check_pub_cutoff(post_pub_raw, datetime.now(timezone.utc))
                if not should_keep:
                    dropped_old += 1
                    continue

                exists = session.execute(
                    select(CommunityPost).where(
                        CommunityPost.election_id == election_id,
                        CommunityPost.url == url,
                    )
                ).scalar_one_or_none()
                if exists:
                    if exists.published_at is None and post_pub_at is not None:
                        exists.published_at = post_pub_at
                    continue

                seen_urls.add(url)
                raw_items.append({
                    "id": url,
                    "title": post["title"],
                    "description": post.get("description", "")[:500],
                    "url": url,
                    "source": post.get("author", ""),
                    "published_at": post_pub_at,
                    "platform": post.get("platform", "naver_blog"),
                    "candidate_id": str(matched_cand.id),
                    "candidate_name": matched_cand.name,
                    "relevance_score": calculate_relevance(post_text, cand_names) / 100.0,
                })

        # AI 스크리닝
        filtered_out = 0
        if raw_items:
            try:
                from app.collectors.ai_screening import screen_collected_items
                all_hints = []
                for c in candidates:
                    all_hints.extend(c.homonym_filters or [])
                screened = _run_async(screen_collected_items(
                    items=raw_items,
                    our_candidate_name=our_cand.name if our_cand else candidates[0].name,
                    rival_candidate_names=rival_names,
                    election_type=type_label,
                    region=f"{election.region_sido or ''} {election.region_sigungu or ''}".strip() if election else "",
                    homonym_hints=list(set(all_hints)),
                    tenant_id=tenant_id,
                ))
                filtered_out = len(raw_items) - len(screened)
            except Exception as scr_err:
                logger.error("community_ai_screening_failed", error=str(scr_err)[:200])
                screened = raw_items

            from sqlalchemy.dialects.postgresql import insert as pg_insert
            from app.analysis.strategic_views import upsert_strategic_view_sync
            for item in screened:
                ai_ok = item.get("ai_screened", False)
                stmt = pg_insert(CommunityPost).values(
                    tenant_id=tenant_id, election_id=election_id,
                    candidate_id=UUID(item["candidate_id"]),
                    title=item["title"], url=item["url"],
                    source=item.get("source", ""),
                    content_snippet=item.get("description", "")[:200],
                    published_at=item.get("published_at"),
                    relevance_score=item.get("relevance_score", 0.0),
                    platform=item.get("platform", "naver_blog"),
                    is_relevant=True,
                    sentiment=item.get("sentiment") if ai_ok else None,
                    sentiment_score=item.get("sentiment_score") if ai_ok else None,
                    ai_summary=item.get("ai_summary") if ai_ok else None,
                    ai_reason=item.get("ai_reason") if ai_ok else None,
                    ai_threat_level=item.get("threat_level") if ai_ok else None,
                ).on_conflict_do_nothing(constraint="uq_community_url_per_election")
                res = session.execute(stmt)
                if res.rowcount:
                    total += 1

                if ai_ok:
                    row = session.execute(
                        select(CommunityPost.id).where(
                            CommunityPost.election_id == election_id,
                            CommunityPost.url == item["url"],
                        )
                    ).scalar()
                    if row:
                        upsert_strategic_view_sync(
                            session, "community",
                            source_id=row,
                            tenant_id=tenant_id,
                            election_id=election_id,
                            candidate_id=UUID(item["candidate_id"]),
                            strategic_quadrant=item.get("strategic_quadrant"),
                            action_type=item.get("action_type"),
                            action_priority=item.get("action_priority"),
                            action_summary=item.get("action_summary"),
                            is_about_our_candidate=item.get("is_about_our_candidate"),
                        )

                try:
                    from app.collectors.race_shared import upsert_race_community_sync
                    upsert_race_community_sync(
                        session, election_id=str(election_id),
                        title=item["title"], url=item["url"],
                        source=item.get("source", ""),
                        content_snippet=item.get("description", "")[:200],
                        platform=item.get("platform", "naver_blog"),
                        published_at=item.get("published_at"),
                    )
                except Exception as rs_err:
                    logger.warning("race_shared_community_failed", error=str(rs_err)[:200])

        session.commit()

        ai_result = {}
        if total > 0:
            try:
                ai_result = _run_async(_run_full_ai_pipeline(tenant_id, election_id))
            except Exception as ai_err:
                logger.error("community_ai_pipeline_error", error=str(ai_err)[:300])

        run.status = "success"
        run.completed_at = datetime.now(timezone.utc)
        run.items_collected = total
        run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        session.commit()
        return {"status": "success", "items": total, "dropped_old": dropped_old, "ai": ai_result}

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
    """유튜브 영상 수집 → 품질/날짜/동명이인 필터(youtube.py) → AI 파이프라인."""
    from app.collectors.youtube import YouTubeCollector
    from app.collectors.filters import parse_published_at
    from app.elections.models import ScheduleRun, Candidate, YouTubeVideo

    session = get_sync_session()
    run = ScheduleRun(schedule_id=schedule_id, tenant_id=tenant_id, status="running")
    session.add(run)
    session.commit()

    try:
        # ── 같은 election에서 최근 수집이 있으면 스킵 (쿼터 절감: 60분 → 12시간) ──
        # 유튜브는 업로드 빈도 낮아 12시간 캐시로 충분. 캠프 6개 × 스케줄 3회 × 후보 5명 중복 호출 방지.
        recent = _check_recent_collection(session, election_id, "youtube", within_minutes=720)
        if recent and recent["tenant_id"] != tenant_id:
            logger.info("youtube_skip_recent_exists",
                        tenant=tenant_id, other_tenant=recent["tenant_id"],
                        minutes_ago=recent["minutes_ago"])
            ai_result = {}
            try:
                ai_result = _run_async(_run_full_ai_pipeline(tenant_id, election_id))
            except Exception:
                pass
            run.status = "success"
            run.completed_at = datetime.now(timezone.utc)
            run.items_collected = 0
            run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
            session.commit()
            return {"status": "skipped_recent", "items": 0, "ai": ai_result}

        candidates = session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.enabled == True,
            )
        ).scalars().all()
        # election-shared: is_our_candidate 을 tenant_elections 기준으로 덮어씀
        _our_cand_id = session.execute(text(
            "SELECT our_candidate_id FROM tenant_elections "
            "WHERE tenant_id = :tid AND election_id = :eid AND our_candidate_id IS NOT NULL"
        ), {"tid": str(tenant_id), "eid": str(election_id)}).scalar()
        for _c in candidates:
            _c.is_our_candidate = bool(_our_cand_id and str(_c.id) == str(_our_cand_id))

        collector = YouTubeCollector(settings.YOUTUBE_API_KEY or settings.GOOGLE_API_KEY, settings.YOUTUBE_API_KEY_2)
        our_cand = next((c for c in candidates if c.is_our_candidate), None)
        rival_names = [c.name for c in candidates if not c.is_our_candidate]
        total = 0
        raw_items = []

        from app.elections.models import Election as _Election
        from app.elections.korea_data import ELECTION_ISSUES, REGIONS
        election = session.execute(select(_Election).where(_Election.id == election_id)).scalar_one_or_none()
        etype = election.election_type if election else "mayor"
        _raw_label = ELECTION_ISSUES.get(etype, {}).get("label", "후보")
        type_label = _raw_label.split("(")[0].strip().split(" ")[0]

        for cand in candidates:
            homonym = None
            if cand.homonym_filters:
                homonym = {
                    "exclude": cand.homonym_filters,
                    "require_any": ["선거", "후보", "공약", "출마", type_label],
                }
            for keyword in (cand.search_keywords or [cand.name]):
                videos = _run_async(collector.search_videos(
                    keyword, max_results=10, homonym_filters=homonym,
                ))

                for vid in videos:
                    exists = session.execute(
                        select(YouTubeVideo).where(
                            YouTubeVideo.election_id == election_id,
                            YouTubeVideo.video_id == vid["video_id"],
                        )
                    ).scalar_one_or_none()

                    pub_at = parse_published_at(vid.get("published_at"))

                    if exists:
                        if vid.get("views", 0) > (exists.views or 0):
                            exists.views = vid["views"]
                            exists.likes = vid.get("likes", 0)
                            exists.comments_count = vid.get("comments_count", 0)
                        if exists.published_at is None and pub_at is not None:
                            exists.published_at = pub_at
                        continue

                    raw_items.append({
                        "id": vid["video_id"],
                        "title": vid["title"],
                        "description": vid.get("description", "")[:500],
                        "video_id": vid["video_id"],
                        "channel": vid.get("channel", ""),
                        "thumbnail": vid.get("thumbnail", ""),
                        "published_at": pub_at,
                        "views": vid.get("views", 0),
                        "likes": vid.get("likes", 0),
                        "comments_count": vid.get("comments_count", 0),
                        "candidate_id": str(cand.id),
                        "candidate_name": cand.name,
                    })

        # AI 스크리닝
        filtered_out = 0
        if raw_items:
            try:
                from app.collectors.ai_screening import screen_collected_items
                all_hints = []
                for c in candidates:
                    all_hints.extend(c.homonym_filters or [])
                screened = _run_async(screen_collected_items(
                    items=raw_items,
                    our_candidate_name=our_cand.name if our_cand else candidates[0].name,
                    rival_candidate_names=rival_names,
                    election_type=type_label,
                    region=f"{election.region_sido or ''} {election.region_sigungu or ''}".strip() if election else "",
                    homonym_hints=list(set(all_hints)),
                    tenant_id=tenant_id,
                ))
                filtered_out = len(raw_items) - len(screened)
            except Exception as scr_err:
                logger.error("youtube_ai_screening_failed", error=str(scr_err)[:200])
                screened = raw_items

            from sqlalchemy.dialects.postgresql import insert as pg_insert
            from app.analysis.strategic_views import upsert_strategic_view_sync
            for item in screened:
                ai_ok = item.get("ai_screened", False)
                stmt = pg_insert(YouTubeVideo).values(
                    tenant_id=tenant_id, election_id=election_id,
                    candidate_id=UUID(item["candidate_id"]),
                    video_id=item["video_id"], title=item["title"],
                    channel=item.get("channel", ""),
                    description_snippet=item.get("description", "")[:300],
                    thumbnail_url=item.get("thumbnail", ""),
                    published_at=item.get("published_at"),
                    views=item.get("views", 0), likes=item.get("likes", 0),
                    comments_count=item.get("comments_count", 0),
                    is_relevant=True,
                    sentiment=item.get("sentiment") if ai_ok else None,
                    sentiment_score=item.get("sentiment_score") if ai_ok else None,
                    ai_summary=item.get("ai_summary") if ai_ok else None,
                    ai_reason=item.get("ai_reason") if ai_ok else None,
                    ai_threat_level=item.get("threat_level") if ai_ok else None,
                ).on_conflict_do_nothing(constraint="uq_youtube_per_election")
                res = session.execute(stmt)
                if res.rowcount:
                    total += 1

                if ai_ok:
                    row = session.execute(
                        select(YouTubeVideo.id).where(
                            YouTubeVideo.election_id == election_id,
                            YouTubeVideo.video_id == item["video_id"],
                        )
                    ).scalar()
                    if row:
                        upsert_strategic_view_sync(
                            session, "youtube",
                            source_id=row,
                            tenant_id=tenant_id,
                            election_id=election_id,
                            candidate_id=UUID(item["candidate_id"]),
                            strategic_quadrant=item.get("strategic_quadrant"),
                            action_type=item.get("action_type"),
                            action_priority=item.get("action_priority"),
                            action_summary=item.get("action_summary"),
                            is_about_our_candidate=item.get("is_about_our_candidate"),
                        )

                try:
                    from app.collectors.race_shared import upsert_race_youtube_sync
                    upsert_race_youtube_sync(
                        session, election_id=str(election_id),
                        video_id=item["video_id"], title=item["title"],
                        channel=item.get("channel", ""),
                        description_snippet=item.get("description", "")[:300],
                        thumbnail_url=item.get("thumbnail", ""),
                        views=item.get("views", 0), likes=item.get("likes", 0),
                        comments_count=item.get("comments_count", 0),
                        published_at=item.get("published_at"),
                    )
                except Exception as rs_err:
                    logger.warning("race_shared_youtube_failed", error=str(rs_err)[:200])

        session.commit()

        ai_result = {}
        if total > 0:
            try:
                ai_result = _run_async(_run_full_ai_pipeline(tenant_id, election_id))
            except Exception as ai_err:
                logger.error("youtube_ai_pipeline_error", error=str(ai_err)[:300])

        run.status = "success"
        run.completed_at = datetime.now(timezone.utc)
        run.items_collected = total
        run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        session.commit()
        return {"status": "success", "items": total, "ai": ai_result}

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
                Candidate.enabled == True,
            )
        ).scalars().all()
        # election-shared: is_our_candidate 을 tenant_elections 기준으로 덮어씀
        _our_cand_id = session.execute(text(
            "SELECT our_candidate_id FROM tenant_elections "
            "WHERE tenant_id = :tid AND election_id = :eid AND our_candidate_id IS NOT NULL"
        ), {"tid": str(tenant_id), "eid": str(election_id)}).scalar()
        for _c in candidates:
            _c.is_our_candidate = bool(_our_cand_id and str(_c.id) == str(_our_cand_id))

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
    """최근 뉴스 기사의 댓글 수집. sentiment는 NULL로 저장 (보조 데이터)."""
    from app.collectors.news_comments import collect_comments_for_articles
    from app.elections.models import NewsArticle, Candidate
    from app.elections.history_models import NewsComment

    session = get_sync_session()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

        # election-shared: 같은 선거의 캠프들끼리 기사를 공유하므로 election_id로 필터
        articles = session.execute(
            select(NewsArticle, Candidate.name)
            .join(Candidate, NewsArticle.candidate_id == Candidate.id)
            .where(
                NewsArticle.election_id == election_id,
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
        total = 0

        for article_result in results:
            for comment in article_result.get("comments", []):
                text = comment.get("text", "")
                if not text:
                    continue
                session.add(NewsComment(
                    tenant_id=tenant_id,
                    article_url=article_result["url"],
                    author=comment.get("author", ""),
                    text=text[:500],
                    sympathy_count=comment.get("sympathy", 0),
                    antipathy_count=comment.get("antipathy", 0),
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
                Candidate.enabled == True,
            )
        ).scalars().all()
        # election-shared: is_our_candidate 을 tenant_elections 기준으로 덮어씀
        _our_cand_id = session.execute(text(
            "SELECT our_candidate_id FROM tenant_elections "
            "WHERE tenant_id = :tid AND election_id = :eid AND our_candidate_id IS NOT NULL"
        ), {"tid": str(tenant_id), "eid": str(election_id)}).scalar()
        for _c in candidates:
            _c.is_our_candidate = bool(_our_cand_id and str(_c.id) == str(_our_cand_id))

        collector = CommunityCollector(settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET)
        cand_names = [c.name for c in candidates]
        total = 0

        # 선거 유형 + 우리 후보 + 경쟁자 (AI 스크리닝용)
        from app.elections.models import Election
        election = session.execute(
            select(Election).where(Election.id == election_id)
        ).scalar_one_or_none()
        e_type = election.election_type if election else None
        our_cand = next((c for c in candidates if c.is_our_candidate), None)
        rival_names = [c.name for c in candidates if not c.is_our_candidate]
        type_label = e_type or "선거"
        from app.collectors.filters import parse_published_at
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        raw_items = []
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
                # 사전 중복 제거
                exists = session.execute(
                    select(CommunityPost).where(
                        CommunityPost.election_id == election_id,
                        CommunityPost.url == post["url"],
                    )
                ).scalar_one_or_none()
                if exists:
                    continue

                # 날짜 컷오프
                post_pub_raw = parse_published_at(post.get("published_at") or post.get("pub_date"))
                post_pub_at, should_keep = _check_pub_cutoff(post_pub_raw, datetime.now(timezone.utc))
                if not should_keep:
                    continue

                raw_items.append({
                    "id": post["url"],
                    "title": post["title"],
                    "description": post.get("content_snippet", "")[:500],
                    "url": post["url"],
                    "source": post.get("source", ""),
                    "published_at": post_pub_at,
                    "platform": post.get("platform", "naver_cafe"),
                    "issue_category": post.get("issue_category"),
                    "relevance_score": post.get("relevance_score", 0.0),
                    "engagement": post.get("engagement", {}),
                    "candidate_id": str(cand.id),
                    "candidate_name": cand.name,
                })

        # ── AI 스크리닝 (동명이인 + 관련성 + 감성/전략) ──
        if raw_items:
            try:
                from app.collectors.ai_screening import screen_collected_items
                all_hints = []
                for c in candidates:
                    all_hints.extend(c.homonym_filters or [])
                screened = _run_async(screen_collected_items(
                    items=raw_items,
                    our_candidate_name=our_cand.name if our_cand else candidates[0].name,
                    rival_candidate_names=rival_names,
                    election_type=type_label,
                    region=f"{election.region_sido or ''} {election.region_sigungu or ''}".strip() if election else "",
                    homonym_hints=list(set(all_hints)),
                    tenant_id=tenant_id,
                ))
            except Exception as scr_err:
                logger.error("community_enh_ai_screening_failed", error=str(scr_err)[:200])
                screened = raw_items

            from app.analysis.strategic_views import upsert_strategic_view_sync
            for item in screened:
                ai_ok = item.get("ai_screened", False)
                stmt = pg_insert(CommunityPost).values(
                    tenant_id=tenant_id,
                    election_id=election_id,
                    candidate_id=UUID(item["candidate_id"]),
                    title=item["title"],
                    url=item["url"],
                    source=item.get("source", ""),
                    content_snippet=item.get("description", "")[:200],
                    published_at=item.get("published_at"),
                    issue_category=item.get("issue_category"),
                    relevance_score=item.get("relevance_score", 0.0),
                    engagement=item.get("engagement", {}),
                    platform=item.get("platform", "naver_cafe"),
                    is_relevant=True,
                    sentiment=item.get("sentiment") if ai_ok else None,
                    sentiment_score=item.get("sentiment_score") if ai_ok else None,
                    ai_summary=item.get("ai_summary") if ai_ok else None,
                    ai_reason=item.get("ai_reason") if ai_ok else None,
                    ai_threat_level=item.get("threat_level") if ai_ok else None,
                ).on_conflict_do_nothing(constraint="uq_community_url_per_election")
                res = session.execute(stmt)
                if res.rowcount:
                    total += 1

                if ai_ok:
                    row = session.execute(
                        select(CommunityPost.id).where(
                            CommunityPost.election_id == election_id,
                            CommunityPost.url == item["url"],
                        )
                    ).scalar()
                    if row:
                        upsert_strategic_view_sync(
                            session, "community",
                            source_id=row,
                            tenant_id=tenant_id,
                            election_id=election_id,
                            candidate_id=UUID(item["candidate_id"]),
                            strategic_quadrant=item.get("strategic_quadrant"),
                            strategic_value=item.get("strategic_value") or item.get("strategic_quadrant"),
                            action_type=item.get("action_type"),
                            action_priority=item.get("action_priority"),
                            action_summary=item.get("action_summary"),
                            is_about_our_candidate=item.get("is_about_our_candidate"),
                        )

        session.commit()

        ai_result = {}
        if total > 0:
            try:
                ai_result = _run_async(_run_full_ai_pipeline(tenant_id, election_id))
            except Exception as ai_err:
                logger.error("community_enh_ai_pipeline_error", error=str(ai_err)[:300])

        run.status = "success"
        run.completed_at = datetime.now(timezone.utc)
        run.items_collected = total
        run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        session.commit()
        return {"status": "success", "items": total, "ai": ai_result}

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
    """유튜브 영상 + 숏츠 + 댓글 수집 → AI 파이프라인."""
    from app.collectors.youtube import YouTubeCollector
    from app.collectors.filters import parse_published_at
    from app.elections.models import ScheduleRun, Candidate, YouTubeVideo
    from app.elections.history_models import YouTubeComment

    session = get_sync_session()
    run = ScheduleRun(schedule_id=schedule_id, tenant_id=tenant_id, status="running")
    session.add(run)
    session.commit()

    try:
        # 쿼터 절감: 같은 election에서 12시간 내 다른 캠프가 이미 수집했으면 스킵
        # (유튜브는 뉴스보다 업로드 빈도 낮으니 12시간 캐시로 충분)
        recent = _check_recent_collection(session, election_id, "youtube", within_minutes=720)
        if recent and recent["tenant_id"] != tenant_id:
            logger.info("youtube_enhanced_skip_recent_exists",
                        tenant=tenant_id, other_tenant=recent["tenant_id"],
                        minutes_ago=recent["minutes_ago"])
            run.status = "skipped"
            run.error_message = f"다른 캠프가 {recent['minutes_ago']}분 전에 수집 (쿼터 절감)"
            run.completed_at = datetime.now(timezone.utc)
            session.commit()
            session.close()
            return {"status": "skipped_recent", "minutes_ago": recent["minutes_ago"]}

        candidates = session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.enabled == True,
            )
        ).scalars().all()
        # election-shared: is_our_candidate 을 tenant_elections 기준으로 덮어씀
        _our_cand_id = session.execute(text(
            "SELECT our_candidate_id FROM tenant_elections "
            "WHERE tenant_id = :tid AND election_id = :eid AND our_candidate_id IS NOT NULL"
        ), {"tid": str(tenant_id), "eid": str(election_id)}).scalar()
        for _c in candidates:
            _c.is_our_candidate = bool(_our_cand_id and str(_c.id) == str(_our_cand_id))

        collector = YouTubeCollector(settings.YOUTUBE_API_KEY or settings.GOOGLE_API_KEY, settings.YOUTUBE_API_KEY_2)
        total = 0
        comment_total = 0

        from app.elections.models import Election
        election = session.execute(
            select(Election).where(Election.id == election_id)
        ).scalar_one_or_none()
        e_type = election.election_type if election else "선거"
        our_cand = next((c for c in candidates if c.is_our_candidate), None)
        rival_names = [c.name for c in candidates if not c.is_our_candidate]
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        raw_items = []
        for cand in candidates:
            homonym = None
            if cand.homonym_filters:
                homonym = {
                    "exclude": cand.homonym_filters,
                    "require_any": ["교육", "선거", "후보", "교육감", "출마"],
                }
            for keyword in (cand.search_keywords or [cand.name]):
                # 쿼터 절감: 일반+쇼츠 각각 호출(200u) → 한 번 호출에 is_short 자동 필터(100u)
                # max_results 15로 늘려 쇼츠 포함 전체 확보
                videos = _run_async(collector.search_videos(
                    keyword, max_results=15, homonym_filters=homonym,
                ))
                # 로깅용: 몇 개가 쇼츠로 분류됐는지
                shorts_count = sum(1 for v in videos if v.get("is_short"))
                logger.info("youtube_search_merged", keyword=keyword, total=len(videos), shorts=shorts_count)

                for vid in videos:
                    pub_at = parse_published_at(vid.get("published_at"))
                    exists = session.execute(
                        select(YouTubeVideo).where(
                            YouTubeVideo.election_id == election_id,
                            YouTubeVideo.video_id == vid["video_id"],
                        )
                    ).scalar_one_or_none()
                    if exists:
                        if vid.get("views", 0) > (exists.views or 0):
                            exists.views = vid["views"]
                            exists.likes = vid.get("likes", 0)
                            exists.comments_count = vid.get("comments_count", 0)
                        if exists.published_at is None and pub_at is not None:
                            exists.published_at = pub_at
                        continue

                    raw_items.append({
                        "id": vid["video_id"],
                        "title": vid["title"],
                        "description": (vid.get("description", "") or "")[:500],
                        "url": f"https://www.youtube.com/watch?v={vid['video_id']}",
                        "video_id": vid["video_id"],
                        "channel": vid.get("channel", ""),
                        "thumbnail": vid.get("thumbnail", ""),
                        "published_at": pub_at,
                        "views": vid.get("views", 0),
                        "likes": vid.get("likes", 0),
                        "comments_count": vid.get("comments_count", 0),
                        "candidate_id": str(cand.id),
                        "candidate_name": cand.name,
                    })

        # ── AI 스크리닝 (동명이인 + 관련성 + 감성/전략) ──
        if raw_items:
            try:
                from app.collectors.ai_screening import screen_collected_items
                all_hints = []
                for c in candidates:
                    all_hints.extend(c.homonym_filters or [])
                screened = _run_async(screen_collected_items(
                    items=raw_items,
                    our_candidate_name=our_cand.name if our_cand else candidates[0].name,
                    rival_candidate_names=rival_names,
                    election_type=e_type,
                    region=f"{election.region_sido or ''} {election.region_sigungu or ''}".strip() if election else "",
                    homonym_hints=list(set(all_hints)),
                    tenant_id=tenant_id,
                ))
            except Exception as scr_err:
                logger.error("youtube_enh_ai_screening_failed", error=str(scr_err)[:200])
                screened = raw_items

            from app.analysis.strategic_views import upsert_strategic_view_sync
            for item in screened:
                ai_ok = item.get("ai_screened", False)
                stmt = pg_insert(YouTubeVideo).values(
                    tenant_id=tenant_id,
                    election_id=election_id,
                    candidate_id=UUID(item["candidate_id"]),
                    video_id=item["video_id"],
                    title=item["title"],
                    channel=item.get("channel", ""),
                    description_snippet=item.get("description", "")[:300],
                    thumbnail_url=item.get("thumbnail", ""),
                    published_at=item.get("published_at"),
                    views=item.get("views", 0),
                    likes=item.get("likes", 0),
                    comments_count=item.get("comments_count", 0),
                    is_relevant=True,
                    sentiment=item.get("sentiment") if ai_ok else None,
                    sentiment_score=item.get("sentiment_score") if ai_ok else None,
                    ai_summary=item.get("ai_summary") if ai_ok else None,
                    ai_reason=item.get("ai_reason") if ai_ok else None,
                    ai_threat_level=item.get("threat_level") if ai_ok else None,
                ).on_conflict_do_nothing(constraint="uq_youtube_per_election")
                res = session.execute(stmt)
                if res.rowcount:
                    total += 1

                if ai_ok:
                    row = session.execute(
                        select(YouTubeVideo.id).where(
                            YouTubeVideo.election_id == election_id,
                            YouTubeVideo.video_id == item["video_id"],
                        )
                    ).scalar()
                    if row:
                        upsert_strategic_view_sync(
                            session, "youtube",
                            source_id=row,
                            tenant_id=tenant_id,
                            election_id=election_id,
                            candidate_id=UUID(item["candidate_id"]),
                            strategic_quadrant=item.get("strategic_quadrant"),
                            strategic_value=item.get("strategic_value") or item.get("strategic_quadrant"),
                            action_type=item.get("action_type"),
                            action_priority=item.get("action_priority"),
                            action_summary=item.get("action_summary"),
                            is_about_our_candidate=item.get("is_about_our_candidate"),
                        )

                try:
                    from app.collectors.race_shared import upsert_race_youtube_sync
                    upsert_race_youtube_sync(
                        session,
                        election_id=str(election_id),
                        video_id=item["video_id"],
                        title=item["title"],
                        channel=item.get("channel", ""),
                        description_snippet=item.get("description", "")[:300],
                        thumbnail_url=item.get("thumbnail", ""),
                        views=item.get("views", 0),
                        likes=item.get("likes", 0),
                        comments_count=item.get("comments_count", 0),
                        published_at=item.get("published_at"),
                    )
                except Exception as rs_err:
                    logger.warning("race_shared_youtube_enh_failed", error=str(rs_err)[:200])

            # Comments for top videos (sentiment NULL — 보조 데이터)
            # election-shared: candidate_id 기반 (tenant filter 불필요)
            top_vids = session.execute(
                select(YouTubeVideo).where(
                    YouTubeVideo.candidate_id == cand.id,
                    YouTubeVideo.election_id == election_id,
                )
                .order_by(YouTubeVideo.views.desc()).limit(3)
            ).scalars().all()

            for v in top_vids:
                comments = _run_async(collector.get_video_comments(v.video_id, max_results=10))
                for c in comments:
                    session.add(YouTubeComment(
                        tenant_id=tenant_id,
                        video_id=v.video_id,
                        author=c.get("author", ""),
                        text=c.get("text", "")[:500],
                        like_count=c.get("likes", 0),
                        candidate_name=cand.name,
                    ))
                    comment_total += 1

        session.commit()

        ai_result = {}
        if total > 0:
            try:
                ai_result = _run_async(_run_full_ai_pipeline(tenant_id, election_id))
            except Exception as ai_err:
                logger.error("youtube_enh_ai_pipeline_error", error=str(ai_err)[:300])

        run.status = "success"
        run.completed_at = datetime.now(timezone.utc)
        run.items_collected = total
        run.duration_seconds = (run.completed_at - run.started_at).total_seconds()
        session.commit()
        return {"status": "success", "videos": total, "comments": comment_total, "ai": ai_result}

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
                ScheduleConfig.schedule_type.in_(["full_collection", "full_with_briefing"]),
                ScheduleConfig.enabled == True,
            )
        ).scalars().first()

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
                Candidate.enabled == True,
            )
        ).scalars().all()
        # election-shared: is_our_candidate 을 tenant_elections 기준으로 덮어씀
        _our_cand_id = session.execute(text(
            "SELECT our_candidate_id FROM tenant_elections "
            "WHERE tenant_id = :tid AND election_id = :eid AND our_candidate_id IS NOT NULL"
        ), {"tid": str(tenant_id), "eid": str(election_id)}).scalar()
        for _c in candidates:
            _c.is_our_candidate = bool(_our_cand_id and str(_c.id) == str(_our_cand_id))

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

        # 검색량 급등 체크 — AI 동명이인 검증 + Redis dedup
        try:
            from app.elections.models import SearchTrend, NewsArticle
            from sqlalchemy import func as sqlfunc
            yesterday = date.today() - timedelta(days=1)
            two_days_ago = date.today() - timedelta(days=2)

            # Redis 클라이언트 (dedup용)
            import redis
            from app.config import get_settings
            try:
                r = redis.from_url(get_settings().REDIS_URL or "redis://ep_redis:6379")
            except Exception:
                r = None

            for cand in candidates:
                # 1. dedup: 오늘 이미 같은 후보 search_spike 알림 발송했으면 스킵
                dedup_key = f"alert:search_spike:{tenant_id}:{cand.name}:{date.today().isoformat()}"
                if r:
                    try:
                        if r.exists(dedup_key):
                            continue
                    except Exception:
                        pass

                today_vol = session.execute(
                    select(sqlfunc.max(SearchTrend.relative_volume)).where(
                        SearchTrend.keyword == cand.name,
                        func.date(SearchTrend.checked_at) >= yesterday,
                    )
                ).scalar() or 0
                prev_vol = session.execute(
                    select(sqlfunc.max(SearchTrend.relative_volume)).where(
                        SearchTrend.keyword == cand.name,
                        func.date(SearchTrend.checked_at) >= two_days_ago,
                        func.date(SearchTrend.checked_at) < yesterday,
                    )
                ).scalar() or 0

                # 임계치 강화: 2배 → 3배
                if prev_vol > 0 and today_vol > prev_vol * 3:
                    # 2. AI 검증: 같은 시기 실제 정치 관련 뉴스가 증가했는지
                    political_news_today = session.execute(
                        select(sqlfunc.count(NewsArticle.id)).where(
                            NewsArticle.candidate_id == cand.id,
                            func.date(NewsArticle.collected_at) == date.today(),
                            NewsArticle.is_relevant == True,
                        )
                    ).scalar() or 0
                    political_news_prev = session.execute(
                        select(sqlfunc.count(NewsArticle.id)).where(
                            NewsArticle.candidate_id == cand.id,
                            func.date(NewsArticle.collected_at) == yesterday,
                            NewsArticle.is_relevant == True,
                        )
                    ).scalar() or 0

                    # 정치 관련 뉴스도 함께 늘었으면 진짜 이슈, 아니면 동명이인 의심
                    political_increase = political_news_today >= political_news_prev + 3

                    if not political_increase:
                        logger.info("search_spike_skipped_homonym",
                                    candidate=cand.name, today_vol=today_vol, prev_vol=prev_vol,
                                    political_news_today=political_news_today,
                                    political_news_prev=political_news_prev,
                                    reason="검색량은 늘었으나 정치 뉴스는 안 늘어 — 동명이인 가능성")
                        # dedup 키 저장 (오늘 하루 더 안 보냄)
                        if r:
                            try:
                                r.setex(dedup_key, 86400, "skipped_homonym")
                            except Exception:
                                pass
                        continue

                    is_our = cand.is_our_candidate
                    alerts.append({
                        "severity": "critical" if is_our else "warning",
                        "candidate": cand.name,
                        "type": "search_spike",
                        "message": f"{cand.name} 검색량 급등: {prev_vol:.1f} → {today_vol:.1f} ({today_vol/prev_vol:.1f}배) · 정치 뉴스 +{political_news_today - political_news_prev}건",
                        "details": {
                            "previous": prev_vol, "current": today_vol,
                            "political_news_today": political_news_today,
                            "political_news_prev": political_news_prev,
                        },
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })

                    # dedup 키 저장 (오늘 같은 후보 알림 1회만)
                    if r:
                        try:
                            r.setex(dedup_key, 86400, "sent")
                        except Exception:
                            pass
        except Exception as e:
            logger.warning("search_spike_check_error", error=str(e)[:200])

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

    # 2. Opus 감성 분석 + 4사분면 배정 (미분석 전체 — 뉴스 + 커뮤니티)
    analyzed = 0
    try:
        analyzed = _run_async(_opus_analyze_all(tenant_id, election_id))
    except Exception as e:
        logger.warning("opus_analyze_error", error=str(e)[:200])

    # 4. 수집 직후 브리핑
    briefing_result = _run_briefing(tenant_id, election_id, briefing_type)

    # 5. 대시보드 캐시 프리로드 (다음 접속 시 즉시 로딩)
    try:
        _run_async(_preload_dashboard_cache(tenant_id, election_id))
    except Exception as e:
        logger.warning("cache_preload_error", error=str(e)[:200])

    return {
        "collected": collect_result if isinstance(collect_result, dict) else {},
        "sentiment_analyzed": analyzed,
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


@celery_app.task(bind=True, name="briefing.weekly")
def weekly_report(self, tenant_id: str, election_id: str):
    """
    주간 전략 보고서 (월요일 09:00): 7일 추이 분석 → PDF → 텔레그램.
    """
    return _run_weekly_report(tenant_id, election_id)


def _run_briefing(tenant_id: str, election_id: str, briefing_type: str) -> dict:
    """브리핑 공통 로직: briefing_type별 생성 → PDF(일일만) → DB 저장 → 텔레그램 발송.

    규정 (CLAUDE.md 1.22, 2.2.5):
      - morning/afternoon: AI 호출 없이 DB 통계 기반 수치 요약만 (_generate_briefing_text)
      - daily: Opus 16섹션 전략 보고서 (_generate_report_async) + PDF
      - weekly: 별도 _run_weekly_report에서 처리
    """
    import uuid as uuid_mod
    from app.elections.models import Report, Election

    session = get_sync_session()
    try:
        report_text = ""
        ai_generated = False

        if briefing_type == "daily":
            # 일일 보고서만 Opus 16섹션 AI 생성
            try:
                result = _run_async(_generate_report_async(tenant_id, election_id, "daily"))
                report_text = result.get("text", "")
                ai_generated = result.get("ai_generated", False)
            except Exception as e:
                logger.warning("briefing_ai_error", error=str(e), type=briefing_type)

            if not report_text:
                try:
                    report_text = _run_async(
                        _generate_briefing_text(tenant_id, election_id, briefing_type)
                    )
                except Exception as e:
                    logger.error("briefing_fallback_error", error=str(e))
                    report_text = f"보고서 생성 실패: {str(e)[:200]}"
        else:
            # morning/afternoon: AI 호출 없이 DB 통계 기반 수치 요약 (토큰 0)
            try:
                report_text = _run_async(
                    _generate_briefing_text(tenant_id, election_id, briefing_type)
                )
            except Exception as e:
                logger.error("briefing_text_error", error=str(e), type=briefing_type)
                report_text = f"브리핑 생성 실패: {str(e)[:200]}"

        # 3. PDF 생성 (daily 보고서만)
        pdf_path = None
        if briefing_type == "daily":
            try:
                candidates_data = _run_async(_collect_candidates_data(tenant_id, election_id))
                election_obj = session.execute(
                    select(Election).where(Election.id == election_id)
                ).scalar_one_or_none()
                e_name = election_obj.name if election_obj else ""
                e_date = election_obj.election_date if election_obj else None
                d_day = (e_date - date.today()).days if e_date else 0
                our_name = ""
                for cd in (candidates_data or []):
                    if cd.get("is_ours"):
                        our_name = cd["name"]
                        break

                from app.reports.pdf_generator import generate_report_pdf
                pdf_path = generate_report_pdf(
                    report_text=report_text,
                    election_name=e_name,
                    report_date=date.today().isoformat(),
                    report_type="daily",
                    our_candidate=our_name,
                    d_day=d_day,
                    candidates_data=candidates_data,
                )
                logger.info("daily_pdf_generated", path=pdf_path)
            except Exception as e:
                logger.warning("daily_pdf_error", error=str(e)[:200])

        # 4. DB 저장
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
            file_path_pdf=pdf_path,
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

        # 5. 메일 발송 (email_recipients 테이블 기반 복수 수신자, SMTP 미설정 시 자동 skip)
        mail_result = {"status": "skipped", "sent": 0, "total": 0}
        try:
            from app.services.mail_service import (
                send_mail_sync, get_briefing_recipients_sync, render_briefing_html, is_configured,
            )
            if is_configured():
                to_emails = get_briefing_recipients_sync(session, tenant_id, briefing_type)
                if to_emails:
                    type_label = {"morning":"오전 브리핑","afternoon":"오후 브리핑","daily":"일일 보고서"}.get(briefing_type, briefing_type)
                    subject = f"[ElectionPulse] {type_label} — {date.today().strftime('%Y-%m-%d')}"
                    _mail_e_name = ""
                    _mail_our_name = ""
                    try:
                        _el = session.execute(select(Election).where(Election.id == election_id)).scalar_one_or_none()
                        _mail_e_name = _el.name if _el else ""
                        _cand_row = session.execute(text(
                            "SELECT name FROM public.candidates WHERE tenant_id = cast(:tid as uuid) AND is_our_candidate = true LIMIT 1"
                        ), {"tid": tenant_id}).first()
                        _mail_our_name = _cand_row.name if _cand_row else ""
                    except Exception:
                        pass
                    html = render_briefing_html(
                        briefing_type, report_text,
                        election_name=_mail_e_name, candidate_name=_mail_our_name,
                        report_date=date.today().strftime('%Y-%m-%d'),
                    )
                    attachments = []
                    if pdf_path and os.path.exists(pdf_path):
                        with open(pdf_path, "rb") as f:
                            attachments.append((os.path.basename(pdf_path), f.read()))
                    sent_cnt = 0
                    for to in to_emails:
                        r = send_mail_sync(to, subject, html, text_body=report_text, attachments=attachments)
                        if r.get("status") == "sent":
                            sent_cnt += 1
                    mail_result = {"status": "sent" if sent_cnt else "error", "sent": sent_cnt, "total": len(to_emails)}
        except Exception as e:
            logger.error("briefing_mail_error", error=str(e)[:300])
            mail_result = {"status": "error", "error": str(e)[:200]}

        logger.info(
            "briefing_complete",
            type=briefing_type,
            tenant_id=tenant_id,
            ai=ai_generated,
            telegram_sent=sent,
            mail_sent=mail_result.get("sent"),
            mail_total=mail_result.get("total"),
        )

        return {
            "status": "success",
            "briefing_type": briefing_type,
            "ai_generated": ai_generated,
            "telegram_sent": sent,
            "mail": mail_result,
            "report_id": str(report.id),
        }

    except Exception as e:
        logger.error("briefing_error", error=str(e), type=briefing_type)
        return {"status": "error", "error": str(e)[:500]}
    finally:
        session.close()


def _run_weekly_report(tenant_id: str, election_id: str) -> dict:
    """주간 보고서: 7일 추이 + AI 전략 + PDF 생성."""
    import uuid as uuid_mod
    from app.elections.models import Report, Election

    session = get_sync_session()
    try:
        # 1. 주간 데이터 수집
        candidates_data = _run_async(_collect_candidates_data(tenant_id, election_id))

        # 2. AI 주간 분석 생성
        report_text = ""
        ai_generated = False
        try:
            report_text = _run_async(_generate_weekly_report_async(tenant_id, election_id, candidates_data))
            ai_generated = bool(report_text)
        except Exception as e:
            logger.warning("weekly_ai_error", error=str(e)[:200])

        if not report_text:
            report_text = _generate_weekly_fallback(candidates_data)

        # 3. PDF 생성
        pdf_path = None
        try:
            election_obj = session.execute(
                select(Election).where(Election.id == election_id)
            ).scalar_one_or_none()
            e_name = election_obj.name if election_obj else ""
            e_date = election_obj.election_date if election_obj else None
            d_day = (e_date - date.today()).days if e_date else 0
            our_name = next((c["name"] for c in (candidates_data or []) if c.get("is_ours")), "")

            from app.reports.pdf_generator import generate_report_pdf
            pdf_path = generate_report_pdf(
                report_text=report_text,
                election_name=e_name,
                report_date=date.today().isoformat(),
                report_type="weekly",
                our_candidate=our_name,
                d_day=d_day,
                candidates_data=candidates_data,
            )
        except Exception as e:
            logger.warning("weekly_pdf_error", error=str(e)[:200])

        # 4. DB 저장
        report = Report(
            id=uuid_mod.uuid4(),
            tenant_id=tenant_id,
            election_id=election_id,
            report_type="weekly",
            title=f"[주간] {report_text.split(chr(10))[0][:50]}" if report_text else "주간 전략 보고서",
            content_text=report_text,
            file_path_pdf=pdf_path,
            report_date=date.today(),
            sent_via_telegram=False,
        )
        session.add(report)
        session.commit()

        # 5. 텔레그램 발송
        sent = 0
        try:
            sent = _run_async(
                _send_briefing_telegram(tenant_id, report_text, "weekly")
            )
            if sent > 0:
                report.sent_via_telegram = True
                report.sent_at = datetime.now(timezone.utc)
                session.commit()
        except Exception as e:
            logger.error("weekly_telegram_error", error=str(e)[:200])

        # 6. 메일 발송 (주간 보고서 PDF 첨부, 복수 수신자)
        mail_result = {"status": "skipped", "sent": 0, "total": 0}
        try:
            from app.services.mail_service import (
                send_mail_sync, get_briefing_recipients_sync, render_briefing_html, is_configured,
            )
            if is_configured():
                to_emails = get_briefing_recipients_sync(session, tenant_id, "weekly")
                if to_emails:
                    subject = f"[ElectionPulse] 주간 전략 보고서 — {date.today().strftime('%Y-%m-%d')}"
                    html = render_briefing_html(
                        "weekly", report_text,
                        election_name=e_name, candidate_name=our_name,
                        report_date=date.today().strftime('%Y-%m-%d'),
                    )
                    attachments = []
                    if pdf_path and os.path.exists(pdf_path):
                        with open(pdf_path, "rb") as f:
                            attachments.append((os.path.basename(pdf_path), f.read()))
                    sent_cnt = 0
                    for to in to_emails:
                        r = send_mail_sync(to, subject, html, text_body=report_text, attachments=attachments)
                        if r.get("status") == "sent":
                            sent_cnt += 1
                    mail_result = {"status": "sent" if sent_cnt else "error", "sent": sent_cnt, "total": len(to_emails)}
        except Exception as e:
            logger.error("weekly_mail_error", error=str(e)[:300])
            mail_result = {"status": "error", "error": str(e)[:200]}

        logger.info("weekly_report_complete", tenant_id=tenant_id, ai=ai_generated,
                    pdf=bool(pdf_path), mail_sent=mail_result.get("sent"), mail_total=mail_result.get("total"))
        return {"status": "success", "report_id": str(report.id),
                "ai_generated": ai_generated, "mail": mail_result}

    except Exception as e:
        logger.error("weekly_report_error", error=str(e)[:500])
        return {"status": "error", "error": str(e)[:500]}
    finally:
        session.close()


async def _generate_weekly_report_async(tenant_id: str, election_id: str, candidates_data: list) -> str:
    """AI 주간 보고서 텍스트 생성."""
    from app.services.ai_service import call_claude_text
    from app.database import async_session_factory
    from app.elections.models import Election

    async with async_session_factory() as db:
        election = (await db.execute(
            select(Election).where(Election.id == election_id)
        )).scalar_one_or_none()
        e_name = election.name if election else ""
        e_date = election.election_date if election else None
        d_day = (e_date - date.today()).days if e_date else 0
        our = next((c for c in (candidates_data or []) if c.get("is_ours")), {})

        # 팩트시트
        factsheet = f"[주간 전략 보고서 팩트시트]\n"
        factsheet += f"선거: {e_name} | D-{d_day}\n"
        factsheet += f"우리 후보: {our.get('name', '미지정')}\n"
        factsheet += f"분석 기간: 최근 7일\n\n"

        factsheet += "[후보별 주간 현황]\n"
        for c in (candidates_data or []):
            marker = " (우리)" if c.get("is_ours") else ""
            pos_rate = round(c['pos'] / max(c['news'], 1) * 100)
            factsheet += f"- {c['name']}{marker}: 뉴스 {c['news']}건(긍정률 {pos_rate}%), 커뮤니티 {c['community']}건, 유튜브 {c['yt_views']:,}회, 검색 {c['search_vol']:.1f}\n"

        prompt = (
            f"{factsheet}\n\n"
            f"위 데이터를 기반으로 주간 전략 보고서를 작성하세요.\n\n"
            f"[보고서 구조 — 5섹션]\n"
            f"I. 주간 핵심 요약 — 이번 주 가장 중요한 변화 3가지, 전체 판세 한 줄 판정\n"
            f"II. 후보 비교 추이 — 후보별 미디어 노출/감성/검색 변화 분석, 상승/하락 원인\n"
            f"III. 이번 주 주요 이슈 — 뜨거웠던 이슈 TOP 3, 각 이슈의 영향과 대응\n"
            f"IV. 다음 주 전략 — 구체적 행동 계획 5가지 (채널/주제/일정까지)\n"
            f"V. 불편한 진실 — 이번 주 우리에게 불리한 데이터 솔직히\n\n"
            f"[규칙]\n"
            f"- 각 섹션 5~10줄. 전체 3000자 이내\n"
            f"- 숫자와 데이터로 근거 제시\n"
            f"- 추상적 위안 금지. 팩트 중심.\n"
            f"- 검색 트렌드는 동명이인 포함 수치. 낮으면 솔직히 낮다고 보고.\n"
            f"- 한국어로 작성"
        )

        return await call_claude_text(prompt, timeout=120, context="weekly_report", tenant_id=tenant_id, db=db)


def _generate_weekly_fallback(candidates_data: list) -> str:
    """AI 불가 시 데이터 기반 주간 요약."""
    lines = ["주간 전략 보고서 (데이터 기반)", "=" * 30, ""]
    lines.append("I. 후보별 주간 현황")
    for c in (candidates_data or []):
        marker = " *" if c.get("is_ours") else ""
        lines.append(f"  {c['name']}{marker}: 뉴스 {c['news']}건, 커뮤니티 {c['community']}건, 유튜브 {c['yt_views']:,}회")
    lines.append("")
    lines.append("II. 전략 제안")
    lines.append("  (AI 분석 불가 — Claude CLI 설치 필요)")
    lines.append("")
    lines.append("=" * 30)
    lines.append("CampAI | 주간 전략 보고서")
    return "\n".join(lines)


async def _preload_dashboard_cache(tenant_id: str, election_id: str):
    """대시보드 주요 API 캐시를 미리 채움."""
    from app.database import async_session_factory
    from app.services.analysis_service import (
        get_analysis_overview, get_media_overview,
        get_community_data, get_youtube_data,
    )

    async with async_session_factory() as db:
        try:
            await get_analysis_overview(db, tenant_id, election_id, days=7)
            await get_media_overview(db, tenant_id, election_id, days=7)
            await get_community_data(db, tenant_id, election_id, days=30)
            await get_youtube_data(db, tenant_id, election_id, days=30)
            logger.info("dashboard_cache_preloaded", tenant_id=tenant_id)
        except Exception as e:
            logger.warning("cache_preload_partial", error=str(e)[:200])


async def _opus_analyze_all(tenant_id: str, election_id: str) -> int:
    """
    감성 분석 + 4사분면 배정 파이프라인:
    1. Sonnet으로 neutral 전체 감성 분류
    2. 즉시 4사분면 배정 (규칙 기반 — AI 불필요)
       우리+긍정=strength, 우리+부정=weakness, 경쟁+긍정=threat, 경쟁+부정=opportunity
    """
    from app.database import async_session_factory
    from app.analysis.sentiment import SentimentAnalyzer
    from app.common.election_access import get_election_tenant_ids
    from app.elections.models import Candidate, NewsArticle, CommunityPost

    async with async_session_factory() as db:
        from app.common.election_access import get_our_candidate_id
        all_tids = await get_election_tenant_ids(db, election_id)
        since = date.today() - timedelta(days=2)

        # 후보 정보 (4사분면 배정에 필요)
        candidates = (await db.execute(
            select(Candidate).where(Candidate.election_id == election_id, Candidate.enabled == True)
        )).scalars().all()
        cand_map = {str(c.id): c for c in candidates}
        _my_cand_id = await get_our_candidate_id(db, tenant_id, election_id)

        def _get_quadrant(candidate_id: str, sentiment: str) -> str | None:
            """감성 + 후보 관계 → 4사분면 즉시 배정 (tenant_elections 관점)."""
            if sentiment == "neutral":
                return None
            cand = cand_map.get(str(candidate_id))
            if not cand:
                return None
            is_ours = bool(_my_cand_id and str(cand.id) == _my_cand_id)
            if sentiment == "positive":
                return "strength" if is_ours else "threat"
            elif sentiment == "negative":
                return "weakness" if is_ours else "opportunity"
            return None

        # ── 1단계: Sonnet 감성 분류 (neutral 전체) ──
        # election-shared: tenant 필터 불필요
        neutral_news = (await db.execute(
            select(NewsArticle).where(
                NewsArticle.election_id == election_id,
                NewsArticle.sentiment == "neutral",
                NewsArticle.sentiment_verified == False,
                func.date(NewsArticle.collected_at) >= since,
            ).limit(100)
        )).scalars().all()

        neutral_community = (await db.execute(
            select(CommunityPost).where(
                CommunityPost.election_id == election_id,
                CommunityPost.sentiment == "neutral",
                CommunityPost.sentiment_verified == False,
                func.date(CommunityPost.collected_at) >= since,
            ).limit(50)
        )).scalars().all()

        analyzer = SentimentAnalyzer()
        updated = 0

        # Sonnet 배치 — 뉴스
        if neutral_news:
            news_map = {str(r.id): r for r in neutral_news}
            items = [{"id": str(r.id), "text": f"{r.title or ''} {r.summary or r.content_snippet or ''}"} for r in neutral_news]
            results = await analyzer.analyze_batch(items)
            for r in results:
                if r["sentiment"] != "neutral":
                    row = news_map.get(r["id"])
                    quadrant = _get_quadrant(row.candidate_id, r["sentiment"]) if row else None
                    await db.execute(
                        text("UPDATE news_articles SET sentiment = :s, sentiment_score = :sc, "
                             "sentiment_verified = TRUE, "
                             "strategic_quadrant = :q, strategic_value = :q "
                             "WHERE id = :id"),
                        {"s": r["sentiment"], "sc": r["score"], "q": quadrant, "id": r["id"]},
                    )
                    updated += 1

        # Sonnet 배치 — 커뮤니티
        if neutral_community:
            comm_map = {str(r.id): r for r in neutral_community}
            items = [{"id": str(r.id), "text": f"{r.title or ''} {r.content_snippet or ''}"} for r in neutral_community]
            results = await analyzer.analyze_batch(items)
            for r in results:
                if r["sentiment"] != "neutral":
                    row = comm_map.get(r["id"])
                    quadrant = _get_quadrant(row.candidate_id, r["sentiment"]) if row else None
                    await db.execute(
                        text("UPDATE community_posts SET sentiment = :s, sentiment_score = :sc, "
                             "sentiment_verified = TRUE, "
                             "strategic_quadrant = :q, strategic_value = :q "
                             "WHERE id = :id"),
                        {"s": r["sentiment"], "sc": r["score"], "q": quadrant, "id": r["id"]},
                    )
                    updated += 1

        # ── 2단계: 기존 positive/negative 중 4사분면 미배정 건도 즉시 배정 ──
        no_quad_news = (await db.execute(
            select(NewsArticle).where(
                NewsArticle.election_id == election_id,
                NewsArticle.sentiment.in_(["positive", "negative"]),
                NewsArticle.strategic_quadrant.is_(None),
            ).limit(200)
        )).scalars().all()
        for row in no_quad_news:
            q = _get_quadrant(row.candidate_id, row.sentiment)
            if q:
                await db.execute(
                    text("UPDATE news_articles SET strategic_quadrant = :q, strategic_value = :q, "
                         "sentiment_verified = TRUE WHERE id = :id"),
                    {"q": q, "id": str(row.id)},
                )
                updated += 1

        no_quad_comm = (await db.execute(
            select(CommunityPost).where(
                CommunityPost.election_id == election_id,
                CommunityPost.sentiment.in_(["positive", "negative"]),
                CommunityPost.strategic_quadrant.is_(None),
            ).limit(200)
        )).scalars().all()
        for row in no_quad_comm:
            q = _get_quadrant(row.candidate_id, row.sentiment)
            if q:
                await db.execute(
                    text("UPDATE community_posts SET strategic_quadrant = :q, strategic_value = :q, "
                         "sentiment_verified = TRUE WHERE id = :id"),
                    {"q": q, "id": str(row.id)},
                )
                updated += 1

        if updated:
            await db.commit()

        logger.info("sentiment_pipeline_done",
                     news_input=len(neutral_news), comm_input=len(neutral_community),
                     quadrant_backfill_news=len(no_quad_news), quadrant_backfill_comm=len(no_quad_comm),
                     total_updated=updated)
        return updated


async def _verify_sentiment_with_opus(tenant_id: str, election_id: str) -> int:
    """
    Opus(premium)로 감성 분류 검증 + 4사분면 자동 배정.
    Haiku가 판정한 positive/negative를 Opus가 재확인.
    오분류 시 교정하고, 4사분면(strength/weakness/opportunity/threat) 배정.
    """
    from app.database import async_session_factory
    from app.analysis.sentiment import SentimentAnalyzer
    from app.common.election_access import get_election_tenant_ids
    from app.elections.models import Candidate, NewsArticle, CommunityPost

    async with async_session_factory() as db:
        all_tids = await get_election_tenant_ids(db, election_id)
        since = date.today() - timedelta(days=2)

        # 후보 정보 (우리/경쟁 구분 필요)
        candidates = (await db.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.enabled == True,
            )
        )).scalars().all()
        cand_map = {str(c.id): c for c in candidates}

        # 미검증 + positive/negative인 뉴스 (최근 2일)
        unverified_news = (await db.execute(
            select(NewsArticle).where(
                NewsArticle.election_id == election_id,
                NewsArticle.sentiment.in_(["positive", "negative"]),
                NewsArticle.sentiment_verified == False,
                func.date(NewsArticle.collected_at) >= since,
            ).limit(30)
        )).scalars().all()

        # 미검증 커뮤니티
        unverified_community = (await db.execute(
            select(CommunityPost).where(
                CommunityPost.election_id == election_id,
                CommunityPost.sentiment.in_(["positive", "negative"]),
                CommunityPost.sentiment_verified == False,
                func.date(CommunityPost.collected_at) >= since,
            ).limit(20)
        )).scalars().all()

        all_items = []
        for row in unverified_news:
            cand = cand_map.get(str(row.candidate_id))
            all_items.append({
                "id": str(row.id),
                "table": "news_articles",
                "text": f"{row.title or ''} {row.summary or row.content_snippet or ''}",
                "current_sentiment": row.sentiment,
                "candidate_name": cand.name if cand else "불명",
                "is_our_candidate": bool(cand and _my_cand_id and str(cand.id) == _my_cand_id),
            })

        for row in unverified_community:
            cand = cand_map.get(str(row.candidate_id))
            all_items.append({
                "id": str(row.id),
                "table": "community_posts",
                "text": f"{row.title or ''} {row.content_snippet or ''}",
                "current_sentiment": row.sentiment,
                "candidate_name": cand.name if cand else "불명",
                "is_our_candidate": bool(cand and _my_cand_id and str(cand.id) == _my_cand_id),
            })

        if not all_items:
            logger.info("opus_verify_skip", reason="no unverified items")
            return 0

        analyzer = SentimentAnalyzer()
        results = await analyzer.verify_batch_with_opus(all_items)

        verified = 0
        changed = 0
        for r in results:
            # 원본 테이블 찾기
            item = next((it for it in all_items if it["id"] == r["id"]), None)
            if not item:
                continue

            tbl = item["table"]
            update_sql = (
                f"UPDATE {tbl} SET "
                f"sentiment = :s, sentiment_score = :sc, "
                f"sentiment_verified = TRUE, "
                f"strategic_quadrant = :q, strategic_value = :q "
                f"WHERE id = :id"
            )
            await db.execute(
                text(update_sql),
                {
                    "s": r["sentiment"],
                    "sc": r["score"],
                    "q": r.get("quadrant"),
                    "id": r["id"],
                },
            )
            verified += 1
            if r.get("changed"):
                changed += 1

        if verified:
            await db.commit()
            logger.info(
                "opus_verify_done",
                total=len(all_items),
                verified=verified,
                changed=changed,
                tenant_id=tenant_id,
            )

        return verified


async def _generate_report_async(
    tenant_id: str, election_id: str, report_type: str = "daily",
) -> dict:
    """AI 보고서 생성 (async context). report_type: daily | weekly (morning/afternoon은 호출 금지 — 토큰 낭비)."""
    from app.database import async_session_factory
    from app.reports.ai_report import generate_ai_report

    async with async_session_factory() as db:
        return await generate_ai_report(db, tenant_id, election_id, report_type=report_type)


async def _collect_candidates_data(tenant_id: str, election_id: str) -> list:
    """PDF 보고서용 후보별 데이터 수집."""
    from app.database import async_session_factory
    from app.common.election_access import get_election_tenant_ids, get_our_candidate_id
    from app.elections.models import Candidate, NewsArticle, CommunityPost, YouTubeVideo, SearchTrend
    from sqlalchemy import func as sqlfunc, case

    async with async_session_factory() as db:
        all_tids = await get_election_tenant_ids(db, election_id)
        our_cand_id = await get_our_candidate_id(db, tenant_id, election_id)
        since = date.today() - timedelta(days=7)

        candidates = (await db.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.enabled == True,
            ).order_by(Candidate.priority)
        )).scalars().all()

        result = []
        for c in candidates:
            is_ours = (str(c.id) == our_cand_id) if our_cand_id else c.is_our_candidate

            # 뉴스
            news_row = (await db.execute(
                select(
                    sqlfunc.count().label("cnt"),
                    sqlfunc.sum(case((NewsArticle.sentiment == "positive", 1), else_=0)).label("pos"),
                    sqlfunc.sum(case((NewsArticle.sentiment == "negative", 1), else_=0)).label("neg"),
                ).where(NewsArticle.candidate_id == c.id, func.date(NewsArticle.collected_at) >= since)
            )).one()

            # 커뮤니티
            comm_cnt = (await db.execute(
                select(sqlfunc.count()).where(CommunityPost.candidate_id == c.id)
            )).scalar() or 0

            # 유튜브
            yt_row = (await db.execute(
                select(sqlfunc.count().label("cnt"), sqlfunc.coalesce(sqlfunc.sum(YouTubeVideo.views), 0).label("views"))
                .where(YouTubeVideo.candidate_id == c.id)
            )).one()

            # 검색량
            search = (await db.execute(
                select(SearchTrend.relative_volume)
                .where(SearchTrend.keyword == c.name, SearchTrend.election_id == election_id)
                .order_by(SearchTrend.checked_at.desc()).limit(1)
            )).scalar() or 0

            result.append({
                "name": c.name,
                "party": c.party,
                "is_ours": is_ours,
                "news": news_row.cnt or 0,
                "pos": news_row.pos or 0,
                "neg": news_row.neg or 0,
                "community": comm_cnt,
                "yt_count": yt_row.cnt or 0,
                "yt_views": int(yt_row.views or 0),
                "search_vol": float(search),
            })

        return result


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

            elif stype == "weekly_report":
                # 주간 보고서 (월요일만)
                if now.weekday() == 0:  # Monday
                    weekly_report.delay(tid, eid)
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
    "claude-token-keepalive": {
        "task": "system.claude_token_keepalive",
        "schedule": 14400.0,  # 4시간 (토큰 TTL 8시간의 절반)
    },
    # ─── schedules_v2 (후보자 일정 관리) ─────────────────────
    "candidate-schedules-auto-complete": {
        "task": "schedules_v2.auto_complete_past",
        "schedule": 3600.0,  # 매시간
    },
    "candidate-schedules-expand-recurring": {
        "task": "schedules_v2.expand_recurring",
        # 매일 03:00 KST = 18:00 UTC 전날. 초 단위 간격으로는 매일 실행 유사 효과.
        "schedule": 86400.0,  # 24시간
    },
    "candidate-schedules-morning-reminder": {
        "task": "schedules_v2.morning_result_reminder_prep",
        "schedule": 3600.0,  # 매시간 — 07:00 KST 브리핑 전에 최신 값 보장
    },
    "candidate-schedules-media-match": {
        "task": "schedules_v2.media_match",
        "schedule": 3600.0,  # 매시간 — status=done 일정에 관련 뉴스 매칭
    },
}

# schedules_v2 태스크 등록 (import 순간 Celery에 registered)
import app.schedules_v2.tasks  # noqa: F401, E402


@celery_app.task(name="system.claude_token_keepalive")
def claude_token_keepalive():
    """Claude CLI OAuth 토큰 갱신 — 4시간마다 실행.

    CLI subprocess는 상주 프로세스가 아니므로 토큰이 만료되면 자동 갱신이 안 됨.
    간단한 호출을 보내서 토큰을 미리 갱신하고, 실패 시 로그에 경고.
    """
    import shutil
    import subprocess

    claude_path = shutil.which("claude")
    if not claude_path:
        return {"status": "skip", "reason": "claude not found"}

    try:
        result = subprocess.run(
            [claude_path, "-p", "ping", "--model", "claude-haiku-4-5-20251001",
             "--permission-mode", "plan", "--no-session-persistence",
             "--max-turns", "1"],
            capture_output=True, timeout=30,
        )
        if result.returncode == 0:
            logger.info("claude_token_refreshed")
            return {"status": "ok"}
        else:
            stderr = result.stderr.decode("utf-8", errors="ignore")[:300]
            logger.error("claude_token_refresh_failed", returncode=result.returncode, stderr=stderr)
            return {"status": "error", "stderr": stderr}
    except Exception as e:
        logger.error("claude_token_refresh_error", error=str(e)[:200])
        return {"status": "error", "error": str(e)[:200]}


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
