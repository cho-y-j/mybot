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

    from app.common.election_access import list_election_candidates as _lec_inst
    candidates = await _lec_inst(db, election_id, tenant_id=tenant_id)

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
    filtered_out = 0
    collected_articles = []  # For comment collection
    raw_items = []  # AI 스크리닝 전 임시 리스트
    our_cand = next((c for c in candidates if c.is_our_candidate), None)
    rival_names = [c.name for c in candidates if not c.is_our_candidate]

    for cand in candidates:
        homonym = {
            "exclude": (cand.homonym_filters or []) + GLOBAL_HOMONYM_BLOCK,
            "require_any": require_any,
            "require_name": [cand.name],
        }

        search_kws = []
        for keyword in (cand.search_keywords or [cand.name]):
            search_kws.append(keyword)
        search_kws.append(f"{cand.name} {type_label}")
        if region_short:
            search_kws.append(f"{cand.name} {region_short} {type_label}")
        search_kws = list(dict.fromkeys(search_kws))

        for search_kw in search_kws:
            articles = await collector.search_news(search_kw, display=30, homonym_filters=homonym)

            for article in articles:
                url = article.get("url", "")
                if any(x in url for x in ["help.naver", "naver.com/alias", "naver.com/search", "terms.naver", "policy.naver"]):
                    continue
                title = article.get("title", "")
                if len(title) < 10 or any(x in title for x in ["접수해주세요", "이용약관", "고객센터"]):
                    continue

                # election-shared: 같은 선거에서 같은 URL 이미 있으면 스킵
                exists = (await db.execute(
                    select(NewsArticle).where(
                        NewsArticle.election_id == election_id,
                        NewsArticle.url == url,
                    )
                )).scalar_one_or_none()
                if exists:
                    continue

                from app.collectors.filters import parse_published_at
                pub_at = parse_published_at(article.get("pub_date"))

                # DB에 바로 저장하지 않고 임시 리스트에 추가
                raw_items.append({
                    "id": article["url"],  # 임시 ID로 URL 사용
                    "title": article["title"],
                    "description": article.get("description", "")[:500],
                    "url": article["url"],
                    "source": article.get("source", ""),
                    "published_at": pub_at,
                    "candidate_id": str(cand.id),
                    "candidate_name": cand.name,
                    "homonym_hints": cand.homonym_filters or [],
                })

    # AI 스크리닝: 동명이인/무관 필터링 + 감성/전략 분류
    if raw_items:
        try:
            from app.collectors.ai_screening import screen_collected_items
            all_homonym_hints = []
            for c in candidates:
                all_homonym_hints.extend(c.homonym_filters or [])

            screened = await screen_collected_items(
                items=raw_items,
                our_candidate_name=our_cand.name if our_cand else candidates[0].name,
                rival_candidate_names=rival_names,
                election_type=type_label,
                region=f"{region_full} {region_sigungu}".strip(),
                homonym_hints=list(set(all_homonym_hints)),
                tenant_id=tenant_id,
                db=db,
            )
            filtered_out = len(raw_items) - len(screened)
        except Exception as e:
            logger.error("ai_screening_failed_fallback", error=str(e)[:200])
            screened = raw_items  # AI 실패 시 전부 통과

        # 스크리닝 통과한 것만 DB에 저장 (election-shared upsert)
        from uuid import UUID as _UUID
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from app.analysis.strategic_views import upsert_strategic_view_async
        for item in screened:
            ai_screened = item.get("ai_screened", False)
            stmt = pg_insert(NewsArticle).values(
                tenant_id=tenant_id,  # 첫 수집 캠프 기록용 (nullable)
                election_id=election_id,
                candidate_id=_UUID(item["candidate_id"]),
                title=item["title"],
                url=item["url"],
                source=item.get("source", ""),
                summary=item.get("description", "")[:300],
                platform="naver",
                published_at=item.get("published_at"),
                is_relevant=True,
                sentiment=item.get("sentiment") if ai_screened else None,
                sentiment_score=item.get("sentiment_score") if ai_screened else None,
                ai_summary=item.get("ai_summary") if ai_screened else None,
                ai_reason=item.get("ai_reason") if ai_screened else None,
                ai_threat_level=item.get("threat_level") if ai_screened else None,
            ).on_conflict_do_update(
                constraint="uq_news_url_per_election",
                set_={
                    "published_at": pg_insert(NewsArticle).excluded.published_at,
                },
            ).returning(NewsArticle.id)
            res = await db.execute(stmt)
            news_row_id = res.scalar()
            total += 1

            # 캠프별 전략 관점 분석 기록
            if ai_screened and news_row_id:
                await upsert_strategic_view_async(
                    db, "news",
                    source_id=news_row_id,
                    tenant_id=tenant_id,
                    election_id=election_id,
                    candidate_id=_UUID(item["candidate_id"]),
                    strategic_quadrant=item.get("strategic_quadrant"),
                    strategic_value=item.get("strategic_value") or item.get("strategic_quadrant"),
                    action_type=item.get("action_type"),
                    action_priority=item.get("action_priority"),
                    action_summary=item.get("action_summary"),
                    is_about_our_candidate=item.get("is_about_our_candidate"),
                )

            collected_articles.append({
                "url": item["url"],
                "title": item["title"],
                "candidate": item["candidate_name"],
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
    logger.info("instant_news_collected", tenant_id=tenant_id, total=total, filtered=filtered_out, comments=comment_count)
    return {"type": "news", "collected": total, "filtered": filtered_out, "comments": comment_count}


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

            # 댓글은 보조 데이터 — sentiment NULL, 필요 시 별도 분석
            db.add(NewsComment(
                tenant_id=tenant_id,
                article_url=article_result["url"],
                author=comment.get("author", ""),
                text=text[:500],
                sympathy_count=comment.get("sympathy", 0),
                antipathy_count=comment.get("antipathy", 0),
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

    from app.common.election_access import list_election_candidates as _lec_inst
    candidates = await _lec_inst(db, election_id, tenant_id=tenant_id)

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
    our_cand = next((c for c in candidates if c.is_our_candidate), None)
    rival_names = [c.name for c in candidates if not c.is_our_candidate]
    total = 0
    filtered_out = 0
    raw_items = []

    for cand in candidates:
        keywords = cand.search_keywords or [cand.name]
        search_keywords = list(keywords)
        search_keywords.append(f"{cand.name} {type_label}")
        if region_short:
            search_keywords.append(f"{cand.name} {region_short} {type_label}")
        search_keywords = list(dict.fromkeys(search_keywords))

        posts = await community_collector.collect_all(
            keywords=search_keywords, candidate_names=cand_names, max_per_keyword=8,
        )

        exclude_words = (cand.homonym_filters or []) + GLOBAL_HOMONYM_BLOCK
        base_relevance = ["선거", "후보", "공약", "캠프", "출마", "지지", "유세", "경선", "공천"]
        relevance_words = base_relevance + [w for w in [type_label, region_short, region_full, region_sigungu] if w]

        for post in posts:
            title = post.get("title", "")
            content = post.get("content_snippet", "")
            text_full = f"{title} {content}"
            text = text_full.lower()

            if exclude_words and any(w.lower() in text for w in exclude_words):
                continue
            if cand.name not in text_full:
                continue
            if not any(w in text for w in relevance_words):
                continue

            exists = (await db.execute(
                select(CommunityPost).where(
                    CommunityPost.election_id == election_id,
                    CommunityPost.url == post["url"],
                )
            )).scalar_one_or_none()
            if exists:
                continue

            from app.collectors.filters import parse_published_at
            pub_at = parse_published_at(post.get("pub_date") or post.get("published_at"))

            raw_items.append({
                "id": post["url"],
                "title": post["title"],
                "description": post.get("content_snippet", "")[:500],
                "url": post["url"],
                "source": post.get("source", ""),
                "published_at": pub_at,
                "candidate_id": str(cand.id),
                "candidate_name": cand.name,
                "issue_category": post.get("issue_category"),
                "relevance_score": post.get("relevance_score", 0.0),
                "engagement": post.get("engagement", {}),
                "platform": post.get("platform", "naver_cafe"),
            })

    # AI 스크리닝
    if raw_items:
        try:
            from app.collectors.ai_screening import screen_collected_items
            all_homonym_hints = []
            for c in candidates:
                all_homonym_hints.extend(c.homonym_filters or [])

            screened = await screen_collected_items(
                items=raw_items,
                our_candidate_name=our_cand.name if our_cand else candidates[0].name,
                rival_candidate_names=rival_names,
                election_type=type_label,
                region=f"{region_full} {region_sigungu}".strip(),
                homonym_hints=list(set(all_homonym_hints)),
                tenant_id=tenant_id, db=db,
            )
            filtered_out = len(raw_items) - len(screened)
        except Exception as e:
            logger.error("ai_screening_community_fallback", error=str(e)[:200])
            screened = raw_items

        from uuid import UUID as _UUID
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from app.analysis.strategic_views import upsert_strategic_view_async
        for item in screened:
            ai_screened = item.get("ai_screened", False)
            stmt = pg_insert(CommunityPost).values(
                tenant_id=tenant_id, election_id=election_id,
                candidate_id=_UUID(item["candidate_id"]),
                title=item["title"], url=item["url"],
                source=item.get("source", ""),
                content_snippet=item.get("description", "")[:200],
                issue_category=item.get("issue_category"),
                relevance_score=item.get("relevance_score", 0.0),
                engagement=item.get("engagement", {}),
                platform=item.get("platform", "naver_cafe"),
                published_at=item.get("published_at"),
                is_relevant=True,
                sentiment=item.get("sentiment") if ai_screened else None,
                sentiment_score=item.get("sentiment_score") if ai_screened else None,
                ai_summary=item.get("ai_summary") if ai_screened else None,
                ai_reason=item.get("ai_reason") if ai_screened else None,
                ai_threat_level=item.get("threat_level") if ai_screened else None,
            ).on_conflict_do_update(
                constraint="uq_community_url_per_election",
                set_={"published_at": pg_insert(CommunityPost).excluded.published_at},
            ).returning(CommunityPost.id)
            res = await db.execute(stmt)
            post_row_id = res.scalar()
            total += 1

            if ai_screened and post_row_id:
                await upsert_strategic_view_async(
                    db, "community",
                    source_id=post_row_id,
                    tenant_id=tenant_id,
                    election_id=election_id,
                    candidate_id=_UUID(item["candidate_id"]),
                    strategic_quadrant=item.get("strategic_quadrant"),
                    action_type=item.get("action_type"),
                    action_priority=item.get("action_priority"),
                    action_summary=item.get("action_summary"),
                    is_about_our_candidate=item.get("is_about_our_candidate"),
                )

    await db.flush()
    logger.info("instant_community_collected", tenant_id=tenant_id, total=total, filtered=filtered_out)
    return {"type": "community", "collected": total, "filtered": filtered_out}


async def collect_youtube_now(db: AsyncSession, tenant_id: str, election_id: str) -> dict:
    """유튜브 즉시 수집 (일반 영상 + 숏츠 + 댓글) — 동명이인 필터 적용."""
    from app.elections.models import Election
    from app.elections.korea_data import ELECTION_ISSUES, REGIONS

    from app.common.election_access import list_election_candidates as _lec_yt
    candidates = await _lec_yt(db, election_id, tenant_id=tenant_id)

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

    collector = YouTubeCollector(settings.YOUTUBE_API_KEY or settings.GOOGLE_API_KEY, settings.YOUTUBE_API_KEY_2)
    our_cand = next((c for c in candidates if c.is_our_candidate), None)
    rival_names = [c.name for c in candidates if not c.is_our_candidate]
    total = 0
    keyword_filtered = 0
    raw_items = []

    # 동명이인 자동 차단 목록 로드 (channel_name / video_id)
    from app.collectors.exclusion_service import load_exclusions, filter_youtube_videos
    exclusions = await load_exclusions(db, election_id)
    excluded_by_list = 0

    for cand in candidates:
        exclude_words = (cand.homonym_filters or []) + GLOBAL_HOMONYM_BLOCK

        search_keywords = []
        for keyword in (cand.search_keywords or [cand.name]):
            if type_label not in keyword and region_short not in keyword:
                search_keywords.append(f"{keyword} {type_label}")
            else:
                search_keywords.append(keyword)
        if cand.name not in search_keywords:
            search_keywords.append(f"{cand.name} {region_short} {type_label}")

        for keyword in search_keywords[:3]:
            # 쿼터 절감: 일반+쇼츠 각 호출(200u) → 통합 1회(100u)
            # search_videos 가 is_short 자동 마킹 (duration 기반)
            videos = await collector.search_videos(keyword, max_results=8)

            # 동명이인 자동 차단 (channel_name / video_id 블랙리스트 적용)
            videos, removed_cnt = filter_youtube_videos(videos, exclusions)
            excluded_by_list += removed_cnt

            for vid in videos:
                title = vid.get("title", "")
                desc = vid.get("description", "")
                text_full = f"{title} {desc}"
                text = text_full.lower()

                if exclude_words and any(w.lower() in text for w in exclude_words):
                    keyword_filtered += 1
                    continue
                if cand.name not in text_full:
                    keyword_filtered += 1
                    continue
                if not any(w in text for w in relevance_words):
                    keyword_filtered += 1
                    continue

                exists = (await db.execute(
                    select(YouTubeVideo).where(
                        YouTubeVideo.election_id == election_id,
                        YouTubeVideo.video_id == vid["video_id"],
                    )
                )).scalar_one_or_none()

                from app.collectors.filters import parse_published_at
                vid_pub_at = parse_published_at(vid.get("published_at"))

                if exists:
                    if vid.get("views", 0) > (exists.views or 0):
                        exists.views = vid["views"]
                        exists.likes = vid.get("likes", 0)
                        exists.comments_count = vid.get("comments_count", 0)
                    if exists.published_at is None and vid_pub_at is not None:
                        exists.published_at = vid_pub_at
                    continue

                raw_items.append({
                    "id": vid["video_id"],
                    "election_id": str(election_id),       # 차단 저장용
                    "title": title,
                    "description": desc[:500],
                    "video_id": vid["video_id"],
                    "channel": vid.get("channel", ""),     # channel_block 차단 대상
                    "thumbnail": vid.get("thumbnail", ""),
                    "published_at": vid_pub_at,
                    "views": vid.get("views", 0),
                    "likes": vid.get("likes", 0),
                    "comments_count": vid.get("comments_count", 0),
                    "candidate_id": str(cand.id),
                    "candidate_name": cand.name,
                    "_platform_hint": "youtube",
                })

    # AI 스크리닝
    filtered_out = 0
    if raw_items:
        try:
            from app.collectors.ai_screening import screen_collected_items
            all_homonym_hints = []
            for c in candidates:
                all_homonym_hints.extend(c.homonym_filters or [])

            screened = await screen_collected_items(
                items=raw_items,
                our_candidate_name=our_cand.name if our_cand else candidates[0].name,
                rival_candidate_names=rival_names,
                election_type=type_label,
                region=f"{(election.region_sido or '')} {(election.region_sigungu or '')}".strip() if election else "",
                homonym_hints=list(set(all_homonym_hints)),
                tenant_id=tenant_id, db=db,
            )
            filtered_out = len(raw_items) - len(screened)
        except Exception as e:
            logger.error("ai_screening_youtube_fallback", error=str(e)[:200])
            screened = raw_items

        from uuid import UUID as _UUID
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from app.analysis.strategic_views import upsert_strategic_view_async
        for item in screened:
            ai_screened = item.get("ai_screened", False)
            stmt = pg_insert(YouTubeVideo).values(
                tenant_id=tenant_id, election_id=election_id,
                candidate_id=_UUID(item["candidate_id"]),
                video_id=item["video_id"], title=item["title"],
                channel=item.get("channel", ""),
                description_snippet=item.get("description", "")[:300],
                thumbnail_url=item.get("thumbnail", ""),
                published_at=item.get("published_at"),
                views=item.get("views", 0), likes=item.get("likes", 0),
                comments_count=item.get("comments_count", 0),
                is_relevant=True,
                sentiment=item.get("sentiment") if ai_screened else None,
                sentiment_score=item.get("sentiment_score") if ai_screened else None,
                ai_summary=item.get("ai_summary") if ai_screened else None,
                ai_reason=item.get("ai_reason") if ai_screened else None,
                ai_threat_level=item.get("threat_level") if ai_screened else None,
            ).on_conflict_do_update(
                constraint="uq_youtube_per_election",
                set_={"published_at": pg_insert(YouTubeVideo).excluded.published_at},
            ).returning(YouTubeVideo.id)
            res = await db.execute(stmt)
            yt_row_id = res.scalar()
            total += 1

            if ai_screened and yt_row_id:
                await upsert_strategic_view_async(
                    db, "youtube",
                    source_id=yt_row_id,
                    tenant_id=tenant_id,
                    election_id=election_id,
                    candidate_id=_UUID(item["candidate_id"]),
                    strategic_quadrant=item.get("strategic_quadrant"),
                    action_type=item.get("action_type"),
                    action_priority=item.get("action_priority"),
                    action_summary=item.get("action_summary"),
                    is_about_our_candidate=item.get("is_about_our_candidate"),
                )

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
                db.add(YouTubeComment(
                    tenant_id=tenant_id, video_id=v.video_id,
                    author=c.get("author", ""), text=c.get("text", "")[:500],
                    like_count=c.get("likes", 0), candidate_name=cand.name,
                ))
                comment_count += 1

    await db.flush()
    logger.info("instant_youtube_collected", tenant_id=tenant_id, total=total, keyword_filtered=keyword_filtered, ai_filtered=filtered_out)
    return {"type": "youtube", "collected": total, "filtered": filtered_out, "comments": comment_count}


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
