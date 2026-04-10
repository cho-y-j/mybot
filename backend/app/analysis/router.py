"""
ElectionPulse - Analysis API
대시보드 + 분석 페이지용 실데이터 엔드포인트
"""
import structlog
from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func, or_, and_, text, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.elections.models import (
    Election, Candidate, NewsArticle, CommunityPost,
    YouTubeVideo, SearchTrend, Survey,
)

router = APIRouter()


# ── B5: Competitor Gap Analysis ──

@router.get("/{election_id}/competitor-gaps")
async def get_competitor_gaps(
    election_id: UUID,
    user: CurrentUser,
    days: int = Query(7, ge=1, le=90),
    refresh: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """경쟁자 대비 갭 분석 — 캐시된 결과 반환, refresh=True면 재분석."""
    import json as _json
    from app.analysis.competitor import analyze_competitor_gaps

    tid = user["tenant_id"]

    # 캐시 확인 (refresh가 아닌 경우)
    if not refresh:
        cached = (await db.execute(text(
            "SELECT data, created_at FROM analysis_cache "
            "WHERE tenant_id = :tid AND election_id = :eid AND cache_type = 'competitor_gaps' "
            "ORDER BY created_at DESC LIMIT 1"
        ), {"tid": str(tid), "eid": str(election_id)})).first()

        if cached:
            data = cached[0] if isinstance(cached[0], dict) else _json.loads(cached[0])
            data["cached"] = True
            data["cached_at"] = cached[1].isoformat() if cached[1] else None
            return data

    # 새로 분석 (refresh=True면 AI 요약 포함)
    result = await analyze_competitor_gaps(db, tid, str(election_id), days=days)
    if refresh:
        from app.analysis.competitor import _generate_ai_summary
        ai_summary = await _generate_ai_summary(result.get("gaps", []), result.get("strengths", []), result.get("our_candidate", ""))
        result["ai_summary"] = ai_summary
    result["cached"] = False

    # 캐시 저장
    try:
        import uuid
        await db.execute(text(
            "INSERT INTO analysis_cache (id, tenant_id, election_id, cache_type, data, created_at) "
            "VALUES (:id, :tid, :eid, 'competitor_gaps', :data, NOW()) "
            "ON CONFLICT (tenant_id, election_id, cache_type) DO UPDATE SET data = :data, created_at = NOW()"
        ), {
            "id": str(uuid.uuid4()), "tid": str(tid), "eid": str(election_id),
            "data": _json.dumps(result, ensure_ascii=False, default=str),
        })
        await db.commit()
    except Exception:
        pass  # 캐시 테이블 없으면 무시

    return result


# ── B5: Content Strategy ──

@router.get("/{election_id}/content-strategy")
async def get_content_strategy(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """AI 콘텐츠 전략 — 블로그/유튜브 주제, 키워드 기회, 해시태그."""
    from app.content.strategy import generate_content_strategy

    tid = user["tenant_id"]
    result = await generate_content_strategy(db, tid, str(election_id))
    if result.get("error"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result


# ── B5: AI Report Generation ──

@router.post("/{election_id}/generate-ai-report")
async def generate_ai_report_endpoint(
    election_id: UUID,
    user: CurrentUser,
    send_telegram: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """AI 전략 보고서 생성 — Claude CLI 기반 5섹션 분석 보고서."""
    from app.reports.ai_report import generate_ai_report
    from app.elections.models import Report
    import uuid as uuid_mod
    from datetime import datetime, timezone

    tid = user["tenant_id"]
    result = await generate_ai_report(db, tid, str(election_id))
    report_text = result.get("text", "")

    if not report_text:
        raise HTTPException(status_code=500, detail="보고서 생성 실패")

    # DB 저장
    report = Report(
        id=uuid_mod.uuid4(),
        tenant_id=tid,
        election_id=election_id,
        report_type="ai_daily",
        title=report_text.split("\n")[0] if report_text else "AI 전략 보고서",
        content_text=report_text,
        report_date=date.today(),
        sent_via_telegram=False,
    )
    db.add(report)

    # 텔레그램 발송 (옵션)
    sent = 0
    if send_telegram:
        try:
            from app.telegram_service.reporter import _send_to_all_recipients
            sent = await _send_to_all_recipients(db, tid, report_text, "briefing")
            if sent > 0:
                report.sent_via_telegram = True
                report.sent_at = datetime.now(timezone.utc)
        except Exception:
            pass

    await db.flush()

    return {
        "message": f"AI 보고서 생성 완료" + (f" (텔레그램 {sent}명 발송)" if sent else ""),
        "report_id": str(report.id),
        "ai_generated": result.get("ai_generated", False),
        "telegram_sent": sent,
        "preview": report_text[:500],
    }


# ── B5: Survey Deep Analysis ──

@router.get("/{election_id}/survey-deep-analysis")
async def get_survey_deep_analysis(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """여론조사 심층 분석 — 교차분석 + 강약 세그먼트 + 추이 + 부동층 + AI 전략."""
    from app.analysis.survey_analyzer import analyze_survey_deep

    tid = user["tenant_id"]
    try:
        result = await analyze_survey_deep(db, tid, str(election_id))
        if result.get("error"):
            return {"error": result["error"], "sections": {}, "total_surveys": 0}
        return result
    except Exception as e:
        import structlog, traceback
        structlog.get_logger().error("survey_analysis_error", error=str(e), traceback=traceback.format_exc()[:500])
        return {"error": f"여론조사 분석 오류: {str(e)[:100]}", "sections": {}, "total_surveys": 0}


# ── B5: History Deep Analysis ──

@router.get("/{election_id}/history-deep-analysis")
async def get_history_deep_analysis(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """과거 선거 심층 분석 — 6가지 차원 + AI 전략."""
    from app.analysis.history_analyzer import analyze_history_deep

    tid = user["tenant_id"]
    try:
        result = await analyze_history_deep(db, tid, str(election_id))
        if result.get("error"):
            return {"error": result["error"], "sections": {}, "elections_count": 0}
        return result
    except Exception as e:
        import structlog
        structlog.get_logger().error("history_analysis_error", error=str(e))
        return {"error": f"과거 선거 분석 오류: {str(e)[:100]}", "sections": {}, "elections_count": 0}


@router.get("/{election_id}/dong-results")
async def get_dong_results(
    election_id: UUID,
    user: CurrentUser,
    sigungu: str = Query(None, description="시·군·구 (없으면 전체)"),
    year: int = Query(None, description="선거 연도 (없으면 최신)"),
    db: AsyncSession = Depends(get_db),
):
    """v3 Phase2: 읍·면·동 단위 개표 결과.

    election_results_dong 테이블 (data.go.kr fileData 기반).
    선거 election_type + 같은 시도에서 동별 결과 조회.
    """
    from app.elections.history_models import ElectionResultDong
    from sqlalchemy import select as sa_select, and_, func

    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
    if not election:
        return {"error": "선거 정보 없음"}

    region = election.region_sido
    etype = election.election_type
    # mayor 카테고리 통합
    types = {"mayor": "mayor", "gun_head": "mayor", "gu_head": "mayor"}.get(etype, etype)

    # 최신 연도 자동
    if year is None:
        latest = (await db.execute(
            sa_select(func.max(ElectionResultDong.election_year)).where(
                ElectionResultDong.region_sido == region,
                ElectionResultDong.election_type == types,
            )
        )).scalar()
        year = latest

    if year is None:
        return {
            "error": f"{region} {etype} 동·읍·면 단위 데이터가 없습니다. 관리자가 data.go.kr fileData를 import해야 합니다.",
            "available": False,
            "region": region,
            "election_type": etype,
        }

    conditions = [
        ElectionResultDong.region_sido == region,
        ElectionResultDong.election_type == types,
        ElectionResultDong.election_year == year,
    ]
    if sigungu:
        conditions.append(ElectionResultDong.region_sigungu == sigungu)

    rows = (await db.execute(
        sa_select(ElectionResultDong).where(*conditions)
        .order_by(ElectionResultDong.region_sigungu, ElectionResultDong.eup_myeon_dong, ElectionResultDong.vote_rate.desc())
    )).scalars().all()

    # 그룹: sigungu -> dong -> [후보 list]
    from collections import defaultdict
    grouped = defaultdict(lambda: defaultdict(list))
    for r in rows:
        grouped[r.region_sigungu][r.eup_myeon_dong].append({
            "candidate_name": r.candidate_name,
            "party": r.party,
            "votes": r.votes,
            "vote_rate": r.vote_rate,
            "is_winner": r.is_winner,
        })

    # 동별 1위 + 격차
    # 청주시 4구를 묶기 위해 parent city 기준 정렬
    import re as _re
    def _parent_city(name: str) -> str:
        m = _re.match(r"^(.+?시)", name or "")
        return m.group(1) if m else (name or "")
    sorted_sgg = sorted(grouped.keys(), key=lambda x: (_parent_city(x), x))

    sigungu_list = []
    for sgg in sorted_sgg:
        dongs = grouped[sgg]
        dong_list = []
        for dong_name, cands in dongs.items():
            sorted_c = sorted(cands, key=lambda c: -(c["vote_rate"] or 0))
            margin = round((sorted_c[0]["vote_rate"] or 0) - (sorted_c[1]["vote_rate"] or 0), 1) if len(sorted_c) > 1 else 0
            dong_list.append({
                "name": dong_name,
                "candidates": sorted_c,
                "winner": sorted_c[0] if sorted_c else None,
                "margin": margin,
            })
        sigungu_list.append({
            "sigungu": sgg,
            "dongs": dong_list,
            "dong_count": len(dong_list),
        })

    return {
        "available": True,
        "year": year,
        "election_type": etype,
        "region": region,
        "sigungu_filter": sigungu,
        "data": sigungu_list,
    }


@router.post("/{election_id}/history-ai-strategy")
async def trigger_history_ai_strategy(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """v2: Claude로 4섹션 구조화 전략 생성 (key_findings / strength / weakness / top_actions)."""
    from app.analysis.history_analyzer import generate_history_ai_strategy
    tid = user["tenant_id"]
    try:
        result = await generate_history_ai_strategy(db, tid, str(election_id))
        return result
    except Exception as e:
        import structlog, traceback
        structlog.get_logger().error("history_ai_strategy_error", error=str(e), tb=traceback.format_exc()[:500])
        return {"text": "", "structured": None, "ai_generated": False, "error": str(e)[:200]}


@router.get("/{election_id}/overview")
async def analysis_overview(
    election_id: UUID,
    user: CurrentUser,
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """대시보드 종합 데이터 — aggregation 최적화 버전."""
    from app.services.analysis_service import get_analysis_overview
    return await get_analysis_overview(db, user["tenant_id"], election_id, days)


def _generate_rule_briefing(our_name: str, news_by_cand: list, scores: list, neg_news: list) -> dict:
    """규칙 기반 빠른 브리핑 — briefing_service로 위임."""
    from app.services.briefing_service import generate_rule_briefing
    return generate_rule_briefing(our_name, news_by_cand, scores, neg_news)


@router.post("/{election_id}/refresh-briefing")
async def refresh_ai_briefing(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """AI 브리핑 수동 재생성 (Claude 호출)."""
    import json as _json, uuid as _uuid
    from app.common.election_access import get_election_tenant_ids, get_our_candidate_id
    from app.services.briefing_service import generate_ai_briefing

    tid = user["tenant_id"]
    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id = await get_our_candidate_id(db, tid, election_id)

    since = date.today() - timedelta(days=7)
    candidates_q = (await db.execute(
        select(Candidate).where(Candidate.election_id == election_id, Candidate.tenant_id.in_(all_tids), Candidate.enabled == True)
    )).scalars().all()

    seen = set()
    candidates = []
    for c in candidates_q:
        if c.name not in seen:
            seen.add(c.name)
            if our_cand_id:
                c.is_our_candidate = (str(c.id) == our_cand_id)
            candidates.append(c)

    our = next((c for c in candidates if c.is_our_candidate), None)

    news_by_cand = []
    for c in candidates:
        cnt = (await db.execute(select(func.count()).where(NewsArticle.candidate_id == c.id, func.date(NewsArticle.collected_at) >= since))).scalar() or 0
        pos = (await db.execute(select(func.count()).where(NewsArticle.candidate_id == c.id, func.date(NewsArticle.collected_at) >= since, NewsArticle.sentiment == "positive"))).scalar() or 0
        neg = (await db.execute(select(func.count()).where(NewsArticle.candidate_id == c.id, func.date(NewsArticle.collected_at) >= since, NewsArticle.sentiment == "negative"))).scalar() or 0
        news_by_cand.append({"name": c.name, "is_ours": c.is_our_candidate, "count": cnt, "positive": pos, "negative": neg})

    score_board = [{"name": c.name, "is_ours": c.is_our_candidate, "news": n["count"], "sentiment_rate": round(n["positive"] / max(n["count"], 1) * 100)} for c, n in zip(candidates, news_by_cand)]

    briefing = await generate_ai_briefing(
        our.name if our else "", news_by_cand, score_board, [], [],
        tenant_id=tid, db=db,
    )

    # 캐시 저장
    try:
        await db.execute(text(
            "INSERT INTO analysis_cache (id, tenant_id, election_id, cache_type, data, created_at) "
            "VALUES (:id, :tid, :eid, 'ai_briefing', :data, NOW()) "
            "ON CONFLICT ON CONSTRAINT uq_analysis_cache_v2 DO UPDATE SET data = EXCLUDED.data, created_at = NOW()"
        ), {
            "id": str(_uuid.uuid4()), "tid": str(tid), "eid": str(election_id),
            "data": _json.dumps(briefing, ensure_ascii=False, default=str),
        })
        await db.commit()
    except Exception as e:
        structlog.get_logger().warning("ai_briefing_cache_write_error", error=str(e)[:200])

    return briefing


async def _generate_ai_briefing(our_name: str, news_by_cand: list, scores: list, neg_news: list, surveys: list) -> dict:
    """Claude AI 기반 일일 브리핑 — briefing_service로 위임."""
    from app.services.briefing_service import generate_ai_briefing
    return await generate_ai_briefing(our_name, news_by_cand, scores, neg_news, surveys)


@router.post("/{election_id}/analyze-media")
async def analyze_media_with_ai(
    election_id: UUID,
    user: CurrentUser,
    limit: int = Query(15, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """미분석 미디어 콘텐츠를 Claude AI로 일괄 분석."""
    from app.analysis.media_analyzer import analyze_all_media
    from app.common.election_access import get_election_tenant_ids

    tid = user["tenant_id"]
    all_tids = await get_election_tenant_ids(db, election_id)

    # 모든 tenant의 데이터를 분석 (공유)
    total = {"news": {"analyzed": 0, "threats": []}, "youtube": {"analyzed": 0, "threats": []}, "community": {"analyzed": 0, "threats": []}, "total_analyzed": 0, "total_threats": 0}

    for tenant_id in all_tids:
        result = await analyze_all_media(db, tenant_id, str(election_id), limit_per_type=limit)
        total["news"]["analyzed"] += result["news"]["analyzed"]
        total["news"]["threats"].extend(result["news"]["threats"])
        total["youtube"]["analyzed"] += result["youtube"]["analyzed"]
        total["youtube"]["threats"].extend(result["youtube"]["threats"])
        total["community"]["analyzed"] += result["community"]["analyzed"]
        total["community"]["threats"].extend(result["community"]["threats"])
        total["total_analyzed"] += result["total_analyzed"]
        total["total_threats"] += result["total_threats"]

    return total


@router.get("/{election_id}/ai-threats")
async def get_ai_threats(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """AI가 식별한 위협 콘텐츠 목록 (medium/high)."""
    from app.common.election_access import get_election_tenant_ids
    all_tids = await get_election_tenant_ids(db, election_id)

    # 뉴스 위협
    news_threats = (await db.execute(text("""
        SELECT n.id, n.title, n.url, n.ai_summary, n.ai_reason, n.ai_threat_level,
               n.collected_at, c.name as candidate
        FROM news_articles n
        JOIN candidates c ON n.candidate_id = c.id
        WHERE n.tenant_id = ANY(:tids) AND n.election_id = :eid
          AND n.ai_threat_level IN ('medium', 'high')
        ORDER BY
          CASE n.ai_threat_level WHEN 'high' THEN 1 ELSE 2 END,
          n.collected_at DESC
        LIMIT 20
    """), {"tids": all_tids, "eid": str(election_id)})).all()

    # 유튜브 위협
    yt_threats = (await db.execute(text("""
        SELECT v.id, v.title, v.video_id, v.ai_summary, v.ai_reason, v.ai_threat_level,
               v.views, v.collected_at, c.name as candidate
        FROM youtube_videos v
        JOIN candidates c ON v.candidate_id = c.id
        WHERE v.tenant_id = ANY(:tids) AND v.election_id = :eid
          AND v.ai_threat_level IN ('medium', 'high')
        ORDER BY
          CASE v.ai_threat_level WHEN 'high' THEN 1 ELSE 2 END,
          v.views DESC NULLS LAST
        LIMIT 20
    """), {"tids": all_tids, "eid": str(election_id)})).all()

    # 커뮤니티 위협
    cm_threats = (await db.execute(text("""
        SELECT p.id, p.title, p.url, p.ai_summary, p.ai_reason, p.ai_threat_level,
               p.collected_at, c.name as candidate
        FROM community_posts p
        JOIN candidates c ON p.candidate_id = c.id
        WHERE p.tenant_id = ANY(:tids) AND p.election_id = :eid
          AND p.ai_threat_level IN ('medium', 'high')
        ORDER BY
          CASE p.ai_threat_level WHEN 'high' THEN 1 ELSE 2 END,
          p.collected_at DESC
        LIMIT 20
    """), {"tids": all_tids, "eid": str(election_id)})).all()

    return {
        "news_threats": [{
            "id": str(r[0]), "title": r[1], "url": r[2],
            "summary": r[3], "reason": r[4], "level": r[5],
            "date": r[6].isoformat() if r[6] else None,
            "candidate": r[7],
        } for r in news_threats],
        "youtube_threats": [{
            "id": str(r[0]), "title": r[1], "video_id": r[2],
            "summary": r[3], "reason": r[4], "level": r[5],
            "views": r[6], "date": r[7].isoformat() if r[7] else None,
            "candidate": r[8],
        } for r in yt_threats],
        "community_threats": [{
            "id": str(r[0]), "title": r[1], "url": r[2],
            "summary": r[3], "reason": r[4], "level": r[5],
            "date": r[6].isoformat() if r[6] else None,
            "candidate": r[7],
        } for r in cm_threats],
        "total": len(news_threats) + len(yt_threats) + len(cm_threats),
    }


@router.get("/{election_id}/media-overview")
async def get_media_overview(
    election_id: UUID,
    user: CurrentUser,
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """통합 미디어 분석 — 뉴스+유튜브+커뮤니티 종합."""
    from app.services.analysis_service import get_media_overview as _get_media
    return await _get_media(db, user["tenant_id"], election_id, days)


@router.get("/{election_id}/community-posts")
async def get_community_posts_list(
    election_id: UUID,
    user: CurrentUser,
    days: int = Query(30, ge=1, le=180),
    candidate: str = "",
    sentiment: str = "",
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
):
    """커뮤니티 게시글 전체 목록 — 필터 + 최신순 정렬."""
    from app.common.election_access import get_election_tenant_ids
    all_tids = await get_election_tenant_ids(db, election_id)
    since = date.today() - timedelta(days=days)

    query = select(CommunityPost, Candidate.name).join(
        Candidate, CommunityPost.candidate_id == Candidate.id
    ).where(
        CommunityPost.tenant_id.in_(all_tids),
        CommunityPost.election_id == election_id,
        or_(
            func.date(CommunityPost.published_at) >= since,
            and_(CommunityPost.published_at.is_(None),
                 func.date(CommunityPost.collected_at) >= since),
        ),
    )

    if candidate:
        query = query.where(Candidate.name == candidate)
    if sentiment:
        query = query.where(CommunityPost.sentiment == sentiment)

    query = query.order_by(
        CommunityPost.published_at.desc().nullslast(),
        CommunityPost.collected_at.desc()
    ).limit(limit)

    rows = (await db.execute(query)).all()
    return [{
        "id": str(p.id),
        "title": p.title,
        "url": p.url,
        "source": p.source,
        "platform": p.platform,
        "snippet": p.content_snippet,
        "sentiment": p.sentiment,
        "issue_category": p.issue_category,
        "engagement": p.engagement or {},
        "ai_summary": p.ai_summary,
        "ai_threat_level": p.ai_threat_level,
        "candidate": cname,
        "published_at": p.published_at.isoformat() if p.published_at else None,
        "collected_at": p.collected_at.isoformat() if p.collected_at else None,
    } for p, cname in rows]


@router.get("/{election_id}/community-data")
async def get_community_data(
    election_id: UUID,
    user: CurrentUser,
    days: int = Query(30, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """커뮤니티(카페/블로그) 분석 — 후보별 게시글, 감성, 이슈 카테고리, 플랫폼별."""
    from app.services.analysis_service import get_community_data as _get_community
    return await _get_community(db, user["tenant_id"], election_id, days)


@router.get("/{election_id}/youtube-data")
async def get_youtube_data(
    election_id: UUID,
    user: CurrentUser,
    days: int = Query(30, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """유튜브 데이터 — 후보별 영상 + 감성 + 통계 + 채널분석 + 위험영상."""
    from app.services.analysis_service import get_youtube_data as _get_youtube
    return await _get_youtube(db, user["tenant_id"], election_id, days)


@router.get("/realtime-trends")
async def get_realtime_trends(user: CurrentUser):
    """실시간 급상승 검색어 (Google Trends RSS)."""
    import httpx
    import xml.etree.ElementTree as ET

    edu_keywords = ['교육', '학교', '급식', '수능', '교사', '학생', '교육감', '입시', '학폭', '돌봄',
                    '충북', '충청', '선거', '후보', '투표', '교육청', '방학', '고교학점제', '늘봄']

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("https://trends.google.com/trending/rss?geo=KR", timeout=10)
            root = ET.fromstring(resp.text)
            ns = {'ht': 'https://trends.google.com/trending/rss'}

            items = []
            for item in root.findall('.//item'):
                title = item.find('title').text or ''
                traffic = item.find('ht:approx_traffic', ns)
                traffic_text = traffic.text if traffic is not None else ''
                is_edu = any(k in title for k in edu_keywords)
                news_items = []
                for ni in item.findall('ht:news_item', ns):
                    nt = ni.find('ht:news_item_title', ns)
                    nu = ni.find('ht:news_item_url', ns)
                    if nt is not None:
                        news_items.append({"title": nt.text, "url": nu.text if nu is not None else ""})

                # 한글 포함된 것만 (외국어 필터)
                import re
                if not re.search(r'[가-힣]', title):
                    continue

                items.append({
                    "keyword": title,
                    "traffic": traffic_text,
                    "is_education_related": is_edu,
                    "news": news_items[:2],
                })

            return {"trends": items, "count": len(items), "source": "Google Trends"}
    except Exception as e:
        return {"trends": [], "count": 0, "error": str(e)}


@router.get("/{election_id}/sentiment-trend")
async def sentiment_trend(
    election_id: UUID, user: CurrentUser,
    days: int = Query(14, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """후보별 일별 뉴스 감성 추이 (실데이터)."""
    tid = user["tenant_id"]
    since = date.today() - timedelta(days=days)

    candidates = (await db.execute(
        select(Candidate).where(Candidate.election_id == election_id, Candidate.tenant_id == tid, Candidate.enabled == True)
    )).scalars().all()

    # 날짜별 후보별 감성 집계
    data = []
    for d in range(days):
        target = since + timedelta(days=d)
        row = {"date": target.strftime("%m/%d")}
        for c in candidates:
            pos = (await db.execute(select(func.count()).where(
                NewsArticle.candidate_id == c.id, func.date(NewsArticle.collected_at) == target,
                NewsArticle.sentiment == "positive",
            ))).scalar() or 0
            neg = (await db.execute(select(func.count()).where(
                NewsArticle.candidate_id == c.id, func.date(NewsArticle.collected_at) == target,
                NewsArticle.sentiment == "negative",
            ))).scalar() or 0
            row[f"{c.name}_pos"] = pos
            row[f"{c.name}_neg"] = neg
        data.append(row)

    return {"trend": data, "candidates": [c.name for c in candidates]}


@router.get("/{election_id}/search-trends")
async def search_trends(
    election_id: UUID, user: CurrentUser,
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
):
    """검색 트렌드 (실데이터)."""
    tid = user["tenant_id"]
    since = date.today() - timedelta(days=days)
    from app.common.election_access import get_election_tenant_ids
    all_tids = await get_election_tenant_ids(db, election_id)

    result = await db.execute(
        select(SearchTrend).where(
            SearchTrend.tenant_id.in_(all_tids),
            SearchTrend.election_id == election_id,
            func.date(SearchTrend.checked_at) >= since,
        ).order_by(SearchTrend.checked_at)
    )

    return {
        "trends": [{
            "keyword": t.keyword, "platform": t.platform,
            "relative_volume": t.relative_volume, "rank": t.rank,
            "checked_at": t.checked_at.isoformat(),
        } for t in result.scalars().all()]
    }


@router.get("/{election_id}/issue-candidate-matrix")
async def get_issue_candidate_matrix(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    이슈 × 후보 교차 분석 매트릭스.
    각 이슈-후보 조합의 연관 검색량을 DataLab으로 측정.
    """
    from app.collectors.keyword_tracker import KeywordTracker
    from app.elections.korea_data import ELECTION_ISSUES
    from app.common.election_access import get_election_tenant_ids, get_our_candidate_id
    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id_str = await get_our_candidate_id(db, user["tenant_id"], election_id)

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        raise HTTPException(404, "선거를 찾을 수 없습니다")

    cands_q = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id.in_(all_tids),
            Candidate.enabled == True,
        )
    )).scalars().all()
    cand_names = [c.name for c in cands_q]
    our_name = next((c.name for c in cands_q if c.is_our_candidate), None)

    issues_list = ELECTION_ISSUES.get(
        election.election_type or "superintendent", {}
    ).get("issues", [])[:10]

    tracker = KeywordTracker()
    matrix = {}

    # 이슈별로 후보 연관 검색 — DataLab은 5그룹 제한이라 이슈별 1회 호출
    for issue in issues_list:
        keyword_groups = [
            {"name": name, "keywords": [f"{name} {issue}"]}
            for name in cand_names[:5]
        ]
        try:
            result = await tracker.get_custom_trends(keyword_groups, days=30)
            matrix[issue] = {
                name: {
                    "score": round(result.get(name, {}).get("avg_7d", 0), 1),
                    "trend": result.get(name, {}).get("trend", "insufficient"),
                }
                for name in cand_names[:5]
            }
        except Exception:
            matrix[issue] = {name: {"score": 0, "trend": "insufficient"} for name in cand_names[:5]}

    # 기회 알림 생성
    opportunities = []
    if our_name:
        for issue, scores in matrix.items():
            our_score = scores.get(our_name, {}).get("score", 0)
            max_score = max((s.get("score", 0) for s in scores.values()), default=0)
            top_candidate = max(scores.items(), key=lambda x: x[1].get("score", 0))[0] if scores else ""

            if max_score > 5 and our_score < max_score * 0.3:
                opportunities.append({
                    "issue": issue,
                    "gap": round(max_score - our_score, 1),
                    "leader": top_candidate,
                    "leader_score": max_score,
                    "our_score": our_score,
                    "action": f"'{issue}' 관련 콘텐츠 제작으로 검색 노출 강화 필요",
                })

    return {
        "candidates": cand_names[:5],
        "our_candidate": our_name,
        "issues": issues_list,
        "matrix": matrix,
        "opportunities": opportunities,
    }


@router.get("/{election_id}/swing-voters")
async def get_swing_voter_analysis(
    election_id: UUID,
    user: CurrentUser,
    days: int = Query(30, ge=7, le=90),
    db: AsyncSession = Depends(get_db),
):
    """스윙보터 키워드 탐지 — 지역 민감 이슈 + 부정 감성 교차분석."""
    from app.services.swing_voter_service import detect_swing_indicators
    return await detect_swing_indicators(db, user["tenant_id"], str(election_id), days)


@router.get("/{election_id}/ads")
async def get_ad_analysis(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """경쟁 후보 광고 분석 대시보드 (Meta Ad Library)."""
    from app.services.ad_analysis_service import get_ad_analysis as _get_ads
    return await _get_ads(db, user["tenant_id"], str(election_id))


@router.post("/{election_id}/collect-ads")
async def collect_ads(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Meta 광고 수동 수집 트리거."""
    from app.collectors.meta_ads import collect_meta_ads
    return await collect_meta_ads(db, user["tenant_id"], str(election_id))


@router.post("/{election_id}/reclassify-issues")
async def reclassify_community_issues(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """커뮤니티 게시글 이슈 재분류 (미태깅 + 기존 태깅 모두)."""
    from app.common.election_access import get_election_tenant_ids
    from app.collectors.community_collector import classify_issue

    all_tids = await get_election_tenant_ids(db, election_id)

    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
    e_type = election.election_type if election else None

    # 해당 tenant들의 모든 커뮤니티 게시글
    posts = (await db.execute(
        select(CommunityPost).where(CommunityPost.tenant_id.in_(all_tids))
    )).scalars().all()

    updated = 0
    newly_tagged = 0
    changed = 0

    for p in posts:
        text = f"{p.title or ''} {p.content_snippet or ''}"
        new_issue = classify_issue(text, election_type=e_type)

        if new_issue and new_issue != p.issue_category:
            if p.issue_category is None:
                newly_tagged += 1
            else:
                changed += 1
            p.issue_category = new_issue
            updated += 1

    await db.commit()

    return {
        "total_posts": len(posts),
        "updated": updated,
        "newly_tagged": newly_tagged,
        "changed": changed,
        "election_type": e_type,
    }
