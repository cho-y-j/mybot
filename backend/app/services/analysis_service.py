"""
ElectionPulse - Analysis Service
대시보드 데이터 집계 비즈니스 로직.
"""
import json as _json
import structlog
from collections import Counter, defaultdict
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import select, func, or_, and_, case, text, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Election, Candidate, NewsArticle, CommunityPost,
    YouTubeVideo, SearchTrend, Survey,
)
from app.common.election_access import get_election_tenant_ids, get_our_candidate_id
from app.services.briefing_service import generate_rule_briefing

logger = structlog.get_logger()


# ─────────────────────────────────────────────
# 1. Analysis Overview (대시보드 종합)
# ─────────────────────────────────────────────

async def get_analysis_overview(
    db: AsyncSession,
    tenant_id: str,
    election_id: UUID,
    days: int = 7,
) -> dict:
    """대시보드 종합 데이터 — aggregation 최적화 버전."""
    from app.services.cache_service import get_cache, set_cache

    cache_key = f"overview_{days}d"
    cached = await get_cache(db, tenant_id, str(election_id), cache_key, max_age_hours=1)
    if cached:
        return cached

    today = date.today()
    since = today - timedelta(days=days)
    since_7d = today - timedelta(days=7)

    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id = await get_our_candidate_id(db, tenant_id, election_id)

    # Q1: 선거 + 후보
    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
    all_candidates = (await db.execute(
        select(Candidate).where(Candidate.election_id == election_id, Candidate.tenant_id.in_(all_tids), Candidate.enabled == True)
        .order_by(Candidate.priority)
    )).scalars().all()

    # 중복 제거 + 우리 후보 동적 설정
    seen_names = set()
    candidates = []
    for c in all_candidates:
        if c.name not in seen_names:
            seen_names.add(c.name)
            if our_cand_id:
                c.is_our_candidate = (str(c.id) == our_cand_id)
            candidates.append(c)

    candidates = sorted(candidates, key=lambda c: (0 if c.is_our_candidate else 1, c.priority or 99))
    our = next((c for c in candidates if c.is_our_candidate), None)
    d_day = (election.election_date - today).days if election else 0
    cand_ids = [c.id for c in candidates]
    cand_map = {c.id: c for c in candidates}

    # Q2: 뉴스 집계 — 1쿼리
    news_agg = {}
    if cand_ids:
        news_rows = (await db.execute(
            select(
                NewsArticle.candidate_id,
                func.count().label("total"),
                func.sum(case((NewsArticle.sentiment == "positive", 1), else_=0)).label("pos"),
                func.sum(case((NewsArticle.sentiment == "negative", 1), else_=0)).label("neg"),
            ).where(
                NewsArticle.candidate_id.in_(cand_ids),
                func.date(NewsArticle.collected_at) >= since,
                NewsArticle.is_relevant == True,
            ).group_by(NewsArticle.candidate_id)
        )).all()
        for row in news_rows:
            news_agg[row.candidate_id] = {"total": row.total, "pos": row.pos, "neg": row.neg}

    # Q3: 커뮤니티 집계
    comm_agg = {}
    if cand_ids:
        comm_rows = (await db.execute(
            select(CommunityPost.candidate_id, func.count().label("cnt"))
            .where(CommunityPost.candidate_id.in_(cand_ids), CommunityPost.is_relevant == True)
            .group_by(CommunityPost.candidate_id)
        )).all()
        for row in comm_rows:
            comm_agg[row.candidate_id] = row.cnt

    # Q4: 유튜브 집계
    yt_agg = {}
    if cand_ids:
        yt_rows = (await db.execute(
            select(
                YouTubeVideo.candidate_id,
                func.count().label("cnt"),
                func.coalesce(func.sum(YouTubeVideo.views), 0).label("views"),
            ).where(YouTubeVideo.candidate_id.in_(cand_ids), YouTubeVideo.is_relevant == True)
            .group_by(YouTubeVideo.candidate_id)
        )).all()
        for row in yt_rows:
            yt_agg[row.candidate_id] = {"cnt": row.cnt, "views": int(row.views)}

    # ── 후보별 데이터 조합 + 스코어보드 ──
    news_by_candidate = []
    score_board = []
    radar_data = []
    total_news = 0
    total_negative = 0

    max_news = max((news_agg.get(cid, {}).get("total", 0) for cid in cand_ids), default=1) or 1
    max_comm = max((comm_agg.get(cid, 0) for cid in cand_ids), default=1) or 1
    max_yt = max((yt_agg.get(cid, {}).get("views", 0) for cid in cand_ids), default=1) or 1

    for c in candidates:
        na = news_agg.get(c.id, {"total": 0, "pos": 0, "neg": 0})
        cnt, pos, neg = na["total"], na["pos"], na["neg"]
        comm = comm_agg.get(c.id, 0)
        yt = yt_agg.get(c.id, {"cnt": 0, "views": 0})

        neutral = cnt - pos - neg
        neutral_rate = round(neutral / cnt * 100) if cnt > 0 else 0
        news_by_candidate.append({
            "name": c.name, "is_ours": c.is_our_candidate, "party": c.party,
            "count": cnt, "positive": pos, "negative": neg, "neutral": neutral,
            "neutral_rate": neutral_rate,
            "analysis_quality": "good" if neutral_rate < 50 else ("warning" if neutral_rate < 70 else "low"),
        })
        total_news += cnt
        total_negative += neg

        news_score = min(cnt / max_news * 100, 100) if max_news else 0
        effective = pos + neg
        sent_score = (pos / effective * 100) if effective > 0 else 50
        comm_score = min(comm / max_comm * 100, 100) if max_comm else 0
        yt_score = min(yt["views"] / max_yt * 100, 100) if max_yt else 0
        total_score = round(news_score * 0.3 + sent_score * 0.3 + comm_score * 0.2 + yt_score * 0.2)

        score_board.append({
            "name": c.name, "party": c.party, "is_ours": c.is_our_candidate,
            "score": total_score,
            "news": cnt, "sentiment_rate": round(sent_score),
            "negative_count": neg, "neutral_rate": neutral_rate,
            "community": comm, "youtube_views": yt["views"],
        })

        radar_data.append({
            "name": c.name, "is_ours": c.is_our_candidate,
            "뉴스 노출": round(news_score),
            "긍정 감성": round(sent_score),
            "커뮤니티": round(comm_score),
            "유튜브": round(yt_score),
            "종합": total_score,
        })

    score_board.sort(key=lambda x: -x["score"])
    our_data = next((n for n in news_by_candidate if n["is_ours"]), None)
    our_pos_rate = round(our_data["positive"] / our_data["count"] * 100) if our_data and our_data["count"] > 0 else 0

    # Q5: 7일 감성 추이
    sentiment_7d = []
    if cand_ids:
        sent_rows = (await db.execute(
            select(
                func.date(NewsArticle.collected_at).label("d"),
                NewsArticle.candidate_id,
                func.sum(case((NewsArticle.sentiment == "positive", 1), else_=0)).label("pos"),
                func.sum(case((NewsArticle.sentiment == "negative", 1), else_=0)).label("neg"),
                func.count().label("total"),
            ).where(
                NewsArticle.candidate_id.in_(cand_ids),
                func.date(NewsArticle.collected_at) >= since_7d,
                NewsArticle.is_relevant == True,
            ).group_by(func.date(NewsArticle.collected_at), NewsArticle.candidate_id)
            .order_by(func.date(NewsArticle.collected_at))
        )).all()

        day_data = defaultdict(dict)
        for row in sent_rows:
            d_str = row.d.strftime("%m/%d") if hasattr(row.d, 'strftime') else str(row.d)
            cname = cand_map[row.candidate_id].name
            day_data[d_str][f"{cname}_pos"] = row.pos
            day_data[d_str][f"{cname}_neg"] = row.neg
            day_data[d_str][cname] = round(row.pos / row.total * 100) if row.total > 0 else 0

        for d_str in sorted(day_data.keys()):
            sentiment_7d.append({"date": d_str, **day_data[d_str]})

    # Q6: 부정 뉴스 TOP 3
    neg_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id.in_(all_tids), NewsArticle.election_id == election_id,
            NewsArticle.sentiment == "negative",
            NewsArticle.is_relevant == True,
        )
        .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
        .limit(3)
    )).all()

    neg_list = [{
        "title": n.title, "url": n.url, "candidate": cname,
        "date": (n.published_at or n.collected_at).strftime("%Y-%m-%d") if (n.published_at or n.collected_at) else None,
    } for n, cname in neg_news]

    # Q7: 여론조사
    survey_q = select(Survey).where(Survey.tenant_id.in_(all_tids))
    if election and election.region_sido:
        survey_q = survey_q.where(or_(
            Survey.election_id == election_id,
            Survey.region_sido == election.region_sido,
        ))
    surveys = (await db.execute(survey_q.order_by(Survey.survey_date.desc()).limit(5))).scalars().all()

    survey_list = [{
        "org": s.survey_org, "date": s.survey_date.isoformat() if s.survey_date else None,
        "sample_size": s.sample_size, "results": s.results if isinstance(s.results, dict) else {},
    } for s in surveys]

    # ── AI 브리핑 (캐시만 사용) ──
    ai_briefing = None
    try:
        cached_brief = (await db.execute(text(
            "SELECT data, created_at FROM analysis_cache "
            "WHERE tenant_id = :tid AND election_id = :eid AND cache_type = 'ai_briefing' "
            "ORDER BY created_at DESC LIMIT 1"
        ), {"tid": str(tenant_id), "eid": str(election_id)})).first()
        if cached_brief:
            ai_briefing = _json.loads(cached_brief[0]) if isinstance(cached_brief[0], str) else cached_brief[0]
            ai_briefing["cached"] = True
            ai_briefing["cached_at"] = cached_brief[1].isoformat() if cached_brief[1] else None
    except Exception as e:
        logger.warning("ai_briefing_cache_read_error", error=str(e)[:200])

    if not ai_briefing:
        ai_briefing = generate_rule_briefing(
            our.name if our else "", news_by_candidate, score_board, neg_list,
        )

    # Q8: 4사분면 집계
    quadrant_data = {"strength": 0, "weakness": 0, "opportunity": 0, "threat": 0}
    if cand_ids:
        quad_rows = (await db.execute(
            select(NewsArticle.strategic_quadrant, func.count())
            .where(
                NewsArticle.candidate_id.in_(cand_ids),
                NewsArticle.strategic_quadrant.isnot(None),
                NewsArticle.is_relevant == True,
            ).group_by(NewsArticle.strategic_quadrant)
        )).all()
        for qname, qcount in quad_rows:
            if qname in quadrant_data:
                quadrant_data[qname] = qcount
        # 커뮤니티도 합산
        quad_comm = (await db.execute(
            select(CommunityPost.strategic_quadrant, func.count())
            .where(
                CommunityPost.candidate_id.in_(cand_ids),
                CommunityPost.strategic_quadrant.isnot(None),
                CommunityPost.is_relevant == True,
            ).group_by(CommunityPost.strategic_quadrant)
        )).all()
        for qname, qcount in quad_comm:
            if qname in quadrant_data:
                quadrant_data[qname] += qcount

    # ── 알림 ──
    alerts = []
    if our_data:
        if max_news > 0 and our_data["count"] / max_news < 0.3:
            alerts.append({"level": "critical", "title": "노출 심각 부족",
                "message": f"{our.name} 뉴스 {our_data['count']}건 — 경쟁자 대비 {round(our_data['count']/max_news*100)}%"})
        if our_data["negative"] > 0:
            alerts.append({"level": "warning", "title": "부정 뉴스",
                "message": f"{our.name} 부정 뉴스 {our_data['negative']}건 감지"})
    for n in news_by_candidate:
        if not n["is_ours"] and n["negative"] >= 3:
            alerts.append({"level": "opportunity", "title": f"{n['name']} 약점",
                "message": f"{n['name']} 부정 뉴스 {n['negative']}건 — 공략 가능"})

    result = {
        "election": {
            "name": election.name if election else "",
            "date": election.election_date.isoformat() if election else "",
            "d_day": d_day,
            "candidates_count": len(candidates),
        },
        "kpi": {
            "d_day": d_day, "total_news": total_news,
            "our_pos_rate": our_pos_rate, "negative_alerts": total_negative,
            "survey_count": len(surveys),
        },
        "score_board": score_board,
        "radar_data": radar_data,
        "sentiment_7d": sentiment_7d,
        "news_by_candidate": news_by_candidate,
        "negative_news": neg_list,
        "surveys": survey_list,
        "alerts": alerts,
        "ai_briefing": ai_briefing,
        "our_candidate": our.name if our else None,
        "strategic_quadrant": quadrant_data,
    }
    await set_cache(db, tenant_id, str(election_id), cache_key, result)
    return result


# ─────────────────────────────────────────────
# 2. Media Overview (통합 미디어 분석)
# ─────────────────────────────────────────────

async def get_media_overview(
    db: AsyncSession,
    tenant_id: str,
    election_id: UUID,
    days: int = 7,
) -> dict:
    """통합 미디어 분석 — 뉴스+유튜브+커뮤니티 종합."""
    from app.services.cache_service import get_cache, set_cache
    cache_key = f"media_overview_{days}d"
    cached = await get_cache(db, tenant_id, str(election_id), cache_key, max_age_hours=1)
    if cached:
        return cached

    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id = await get_our_candidate_id(db, tenant_id, election_id)
    since = date.today() - timedelta(days=days)
    yesterday = date.today() - timedelta(days=1)

    candidates_q = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id, Candidate.tenant_id.in_(all_tids), Candidate.enabled == True
        ).order_by(Candidate.priority)
    )).scalars().all()

    result = []
    for c in sorted(candidates_q, key=lambda x: (0 if x.is_our_candidate else 1, x.priority)):
        # 뉴스
        news_row = (await db.execute(
            select(func.count(NewsArticle.id),
                   func.sum(func.cast(NewsArticle.sentiment == "positive", Integer)),
                   func.sum(func.cast(NewsArticle.sentiment == "negative", Integer)),
                   ).where(
                NewsArticle.candidate_id == c.id,
                func.date(NewsArticle.collected_at) >= since,
                NewsArticle.is_relevant == True,
            )
        )).one()
        news_count = news_row[0] or 0
        news_pos = news_row[1] or 0
        news_neg = news_row[2] or 0

        news_yesterday = (await db.execute(
            select(func.count(NewsArticle.id)).where(
                NewsArticle.candidate_id == c.id,
                func.date(NewsArticle.collected_at) == yesterday,
                NewsArticle.is_relevant == True,
            )
        )).scalar() or 0

        # 유튜브
        yt_row = (await db.execute(
            select(func.count(YouTubeVideo.id),
                   func.sum(YouTubeVideo.views),
                   func.sum(YouTubeVideo.likes),
                   func.sum(YouTubeVideo.comments_count),
                   ).where(
                YouTubeVideo.candidate_id == c.id,
                func.date(YouTubeVideo.collected_at) >= since,
                YouTubeVideo.is_relevant == True,
            )
        )).one()
        yt_count = yt_row[0] or 0
        yt_views = yt_row[1] or 0
        yt_likes = yt_row[2] or 0
        yt_comments = yt_row[3] or 0

        # 커뮤니티
        cm_row = (await db.execute(
            select(func.count(CommunityPost.id),
                   func.sum(func.cast(CommunityPost.sentiment == "positive", Integer)),
                   func.sum(func.cast(CommunityPost.sentiment == "negative", Integer)),
                   ).where(
                CommunityPost.candidate_id == c.id,
                func.date(CommunityPost.collected_at) >= since,
                CommunityPost.is_relevant == True,
            )
        )).one()
        cm_count = cm_row[0] or 0
        cm_pos = cm_row[1] or 0
        cm_neg = cm_row[2] or 0

        total_mentions = news_count + yt_count + cm_count
        total_pos = news_pos + cm_pos
        total_neg = news_neg + cm_neg
        total_all_sent = total_pos + total_neg
        pos_rate = round(total_pos / max(total_all_sent, 1) * 100)

        result.append({
            "name": c.name,
            "is_ours": c.is_our_candidate,
            "party": c.party,
            "news": {"count": news_count, "positive": news_pos, "negative": news_neg, "yesterday": news_yesterday},
            "youtube": {"count": yt_count, "views": yt_views, "likes": yt_likes, "comments": yt_comments},
            "community": {"count": cm_count, "positive": cm_pos, "negative": cm_neg},
            "total_mentions": total_mentions,
            "positive_rate": pos_rate,
            "reach_score": news_count * 100 + yt_views + cm_count * 50,
        })

    channel_totals = {
        "news": sum(r["news"]["count"] for r in result),
        "youtube": sum(r["youtube"]["count"] for r in result),
        "youtube_views": sum(r["youtube"]["views"] for r in result),
        "community": sum(r["community"]["count"] for r in result),
    }

    media_result = {
        "candidates": result,
        "channel_totals": channel_totals,
        "period": f"최근 {days}일",
    }
    await set_cache(db, tenant_id, str(election_id), cache_key, media_result)
    return media_result


# ─────────────────────────────────────────────
# 3. Community Data (커뮤니티 분석)
# ─────────────────────────────────────────────

async def get_community_data(
    db: AsyncSession,
    tenant_id: str,
    election_id: UUID,
    days: int = 30,
) -> dict:
    """커뮤니티(카페/블로그) 분석 — 후보별 게시글, 감성, 이슈 카테고리, 플랫폼별."""
    from app.services.cache_service import get_cache, set_cache
    cache_key = f"community_data_{days}d"
    cached = await get_cache(db, tenant_id, str(election_id), cache_key, max_age_hours=1)
    if cached:
        return cached
    all_tids = await get_election_tenant_ids(db, election_id)
    since = date.today() - timedelta(days=days)

    candidates_q = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id, Candidate.tenant_id.in_(all_tids), Candidate.enabled == True
        ).order_by(Candidate.priority)
    )).scalars().all()

    result = []
    all_issues: Counter = Counter()
    platform_totals: Counter = Counter()

    for c in sorted(candidates_q, key=lambda x: (0 if x.is_our_candidate else 1, x.priority)):
        posts = (await db.execute(
            select(CommunityPost).where(
                CommunityPost.candidate_id == c.id,
                or_(
                    func.date(CommunityPost.published_at) >= since,
                    and_(CommunityPost.published_at.is_(None),
                         func.date(CommunityPost.collected_at) >= since),
                ),
            ).order_by(
                CommunityPost.published_at.desc().nullslast(),
                CommunityPost.collected_at.desc()
            ).limit(100)
        )).scalars().all()

        sent = {"positive": 0, "negative": 0, "neutral": 0}
        for p in posts:
            s = p.sentiment or "neutral"
            if s in sent:
                sent[s] += 1

        platforms: Counter = Counter()
        for p in posts:
            platforms[p.platform or "기타"] += 1
            platform_totals[p.platform or "기타"] += 1

        issues: Counter = Counter()
        for p in posts:
            if p.issue_category:
                issues[p.issue_category] += 1
                all_issues[p.issue_category] += 1

        hot_posts = sorted(posts, key=lambda p: (
            p.published_at.isoformat() if p.published_at else (p.collected_at.isoformat() if p.collected_at else '')
        ), reverse=True)[:10]

        daily: defaultdict = defaultdict(int)
        for p in posts:
            if p.collected_at:
                day = p.collected_at.strftime("%m/%d")
                daily[day] += 1

        result.append({
            "name": c.name,
            "is_ours": c.is_our_candidate,
            "total_posts": len(posts),
            "sentiment": sent,
            "platforms": dict(platforms),
            "issues": dict(issues.most_common(10)),
            "daily_trend": [{"date": k, "count": v} for k, v in sorted(daily.items())[-7:]],
            "hot_posts": [{
                "id": str(p.id),
                "title": p.title,
                "url": p.url,
                "source": p.source,
                "platform": p.platform,
                "sentiment": p.sentiment or "neutral",
                "issue_category": p.issue_category,
                "engagement": p.engagement or {},
                "published_at": p.published_at.strftime("%Y-%m-%d") if p.published_at else None,
            } for p in hot_posts],
        })

    comm_result = {
        "candidates": result,
        "total_issues": dict(all_issues.most_common(15)),
        "platform_summary": dict(platform_totals),
        "period": f"최근 {days}일",
    }
    await set_cache(db, tenant_id, str(election_id), cache_key, comm_result)
    return comm_result


# ─────────────────────────────────────────────
# 4. YouTube Data (유튜브 분석)
# ─────────────────────────────────────────────

async def get_youtube_data(
    db: AsyncSession,
    tenant_id: str,
    election_id: UUID,
    days: int = 30,
) -> dict:
    """유튜브 데이터 — 후보별 영상 + 감성 + 통계 + 채널분석 + 위험영상."""
    from app.services.cache_service import get_cache, set_cache
    cache_key = f"youtube_data_{days}d"
    cached = await get_cache(db, tenant_id, str(election_id), cache_key, max_age_hours=1)
    if cached:
        return cached

    all_tids = await get_election_tenant_ids(db, election_id)
    since = date.today() - timedelta(days=days)

    candidates = (await db.execute(
        select(Candidate).where(Candidate.election_id == election_id, Candidate.tenant_id.in_(all_tids), Candidate.enabled == True)
        .order_by(Candidate.priority)
    )).scalars().all()

    from app.elections.history_models import YouTubeComment

    result = []
    all_channels: dict[str, Counter] = {}
    danger_videos = []

    for c in sorted(candidates, key=lambda x: (0 if x.is_our_candidate else 1, x.priority)):
        videos = (await db.execute(
            select(YouTubeVideo).where(
                YouTubeVideo.candidate_id == c.id,
                or_(
                    func.date(YouTubeVideo.published_at) >= since,
                    and_(YouTubeVideo.published_at.is_(None),
                         func.date(YouTubeVideo.collected_at) >= since),
                ),
            ).order_by(
                YouTubeVideo.published_at.desc().nullslast(),
                YouTubeVideo.collected_at.desc()
            ).limit(50)
        )).scalars().all()

        total_views = sum(v.views or 0 for v in videos)
        total_likes = sum(v.likes or 0 for v in videos)
        total_comments = sum(v.comments_count or 0 for v in videos)

        sent_counts = {"positive": 0, "negative": 0, "neutral": 0}
        for v in videos:
            s = v.sentiment or "neutral"
            if s in sent_counts:
                sent_counts[s] += 1

        engagement_rate = round((total_likes + total_comments) / max(total_views, 1) * 100, 2)

        shorts = [v for v in videos if v.title and ('#shorts' in v.title.lower() or '#short' in v.title.lower())]
        regulars = [v for v in videos if v not in shorts]

        for v in videos:
            if (v.views or 0) >= 5000 and v.sentiment == "negative":
                danger_videos.append({
                    "id": str(v.id),
                    "video_id": v.video_id,
                    "title": v.title,
                    "channel": v.channel,
                    "views": v.views,
                    "candidate": c.name,
                    "is_ours": bool(c.is_our_candidate),
                    "category": "우리 위기" if c.is_our_candidate else "경쟁자 리스크",
                    "published_at": (v.published_at or v.collected_at).strftime("%Y-%m-%d") if (v.published_at or v.collected_at) else None,
                    "_sort_dt": v.published_at or v.collected_at,
                    "thumbnail_url": v.thumbnail_url,
                })

        for v in videos:
            ch = v.channel or "알 수 없음"
            if ch not in all_channels:
                all_channels[ch] = Counter()
            all_channels[ch][c.name] += 1

        comment_sentiments = {"positive": 0, "negative": 0, "neutral": 0}
        video_ids = [v.video_id for v in videos[:20]]
        if video_ids:
            comments = (await db.execute(
                select(YouTubeComment).where(
                    YouTubeComment.tenant_id.in_(all_tids),
                    YouTubeComment.video_id.in_(video_ids),
                )
            )).scalars().all()
            for cm in comments:
                s = cm.sentiment or "neutral"
                if s in comment_sentiments:
                    comment_sentiments[s] += 1

        result.append({
            "name": c.name,
            "is_ours": c.is_our_candidate,
            "total_videos": len(videos),
            "total_views": total_views,
            "total_likes": total_likes,
            "total_comments": total_comments,
            "engagement_rate": engagement_rate,
            "sentiment": sent_counts,
            "comment_sentiment": comment_sentiments,
            "shorts_count": len(shorts),
            "regular_count": len(regulars),
            "shorts_views": sum(v.views or 0 for v in shorts),
            "regular_views": sum(v.views or 0 for v in regulars),
            "videos": [{
                "id": str(v.id),
                "video_id": v.video_id,
                "title": v.title,
                "channel": v.channel,
                "views": v.views or 0,
                "likes": v.likes or 0,
                "comments_count": v.comments_count or 0,
                "sentiment": v.sentiment or "neutral",
                # published_at 우선, 없으면 collected_at으로 폴백 (수집 시점이라도 표시)
                "published_at": (v.published_at or v.collected_at).strftime("%Y-%m-%d") if (v.published_at or v.collected_at) else None,
                "thumbnail_url": v.thumbnail_url,
                "is_short": bool(v.title and ('#shorts' in v.title.lower() or '#short' in v.title.lower())),
            } for v in videos],
        })

    channel_analysis = []
    for ch, counts in sorted(all_channels.items(), key=lambda x: sum(x[1].values()), reverse=True)[:15]:
        channel_analysis.append({
            "channel": ch,
            "total": sum(counts.values()),
            "candidates": dict(counts),
        })

    # danger_videos: published_at 역순 정렬 (최신이 위로)
    danger_videos.sort(key=lambda x: x.get("_sort_dt") or date.min, reverse=True)
    for dv in danger_videos:
        dv.pop("_sort_dt", None)

    yt_result = {
        "candidates": result,
        "channel_analysis": channel_analysis,
        "danger_videos": danger_videos,
        "period": f"최근 {days}일",
    }
    await set_cache(db, tenant_id, str(election_id), cache_key, yt_result)
    return yt_result
