"""
ElectionPulse - Analysis API
대시보드 + 분석 페이지용 실데이터 엔드포인트
"""
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
    from sqlalchemy import case, literal_column
    from app.elections.models import CommunityPost, YouTubeVideo

    tid = user["tenant_id"]
    today = date.today()
    since = today - timedelta(days=days)
    since_7d = today - timedelta(days=7)

    # 공통 데이터 조회를 위해 같은 선거에 참여하는 모든 tenant_id 가져오기
    from app.common.election_access import get_election_tenant_ids, get_our_candidate_id
    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id = await get_our_candidate_id(db, tid, election_id)

    # Q1: 선거 + 후보 — election_id 기반, 우리 후보 tenant별 동적 설정
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

    # Q2: 뉴스 집계 — 1쿼리로 전체 (N+1 제거)
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
            ).group_by(NewsArticle.candidate_id)
        )).all()
        for row in news_rows:
            news_agg[row.candidate_id] = {"total": row.total, "pos": row.pos, "neg": row.neg}

    # Q3: 커뮤니티 집계 — 1쿼리
    comm_agg = {}
    if cand_ids:
        comm_rows = (await db.execute(
            select(CommunityPost.candidate_id, func.count().label("cnt"))
            .where(CommunityPost.candidate_id.in_(cand_ids))
            .group_by(CommunityPost.candidate_id)
        )).all()
        for row in comm_rows:
            comm_agg[row.candidate_id] = row.cnt

    # Q4: 유튜브 집계 — 1쿼리
    yt_agg = {}
    if cand_ids:
        yt_rows = (await db.execute(
            select(
                YouTubeVideo.candidate_id,
                func.count().label("cnt"),
                func.coalesce(func.sum(YouTubeVideo.views), 0).label("views"),
            ).where(YouTubeVideo.candidate_id.in_(cand_ids))
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

    # 전체 최대값 (정규화용)
    max_news = max((news_agg.get(cid, {}).get("total", 0) for cid in cand_ids), default=1) or 1
    max_comm = max((comm_agg.get(cid, 0) for cid in cand_ids), default=1) or 1
    max_yt = max((yt_agg.get(cid, {}).get("views", 0) for cid in cand_ids), default=1) or 1

    for c in candidates:
        na = news_agg.get(c.id, {"total": 0, "pos": 0, "neg": 0})
        cnt, pos, neg = na["total"], na["pos"], na["neg"]
        comm = comm_agg.get(c.id, 0)
        yt = yt_agg.get(c.id, {"cnt": 0, "views": 0})

        news_by_candidate.append({
            "name": c.name, "is_ours": c.is_our_candidate, "party": c.party,
            "count": cnt, "positive": pos, "negative": neg, "neutral": cnt - pos - neg,
        })
        total_news += cnt
        total_negative += neg

        # 종합 스코어 (100점 만점)
        news_score = min(cnt / max_news * 100, 100) if max_news else 0  # 30%
        sent_score = (pos / cnt * 100) if cnt > 0 else 50  # 30%
        comm_score = min(comm / max_comm * 100, 100) if max_comm else 0  # 20%
        yt_score = min(yt["views"] / max_yt * 100, 100) if max_yt else 0  # 20%
        total_score = round(news_score * 0.3 + sent_score * 0.3 + comm_score * 0.2 + yt_score * 0.2)

        score_board.append({
            "name": c.name, "party": c.party, "is_ours": c.is_our_candidate,
            "score": total_score,
            "news": cnt, "sentiment_rate": round(sent_score),
            "community": comm, "youtube_views": yt["views"],
        })

        # 레이더 차트 데이터 (0~100 정규화)
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

    # Q5: 7일 감성 추이 — 1쿼리 (aggregation)
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
            ).group_by(func.date(NewsArticle.collected_at), NewsArticle.candidate_id)
            .order_by(func.date(NewsArticle.collected_at))
        )).all()

        # 날짜별로 그룹핑
        from collections import defaultdict
        day_data = defaultdict(dict)
        for row in sent_rows:
            d_str = row.d.strftime("%m/%d") if hasattr(row.d, 'strftime') else str(row.d)
            cname = cand_map[row.candidate_id].name
            day_data[d_str][f"{cname}_pos"] = row.pos
            day_data[d_str][f"{cname}_neg"] = row.neg
            # 긍정률
            day_data[d_str][cname] = round(row.pos / row.total * 100) if row.total > 0 else 0

        for d_str in sorted(day_data.keys()):
            sentiment_7d.append({"date": d_str, **day_data[d_str]})

    # Q6: 부정 뉴스 TOP 3 (대응 필요)
    neg_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id.in_(all_tids), NewsArticle.election_id == election_id,
            NewsArticle.sentiment == "negative",
        )
        .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
        .limit(3)
    )).all()

    neg_list = [{
        "title": n.title, "url": n.url, "candidate": cname,
        "date": (n.published_at or n.collected_at).strftime("%Y-%m-%d") if (n.published_at or n.collected_at) else None,
    } for n, cname in neg_news]

    # Q7: 여론조사 (모든 tenant + 지역 공유)
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

    # ── AI 브리핑 (캐시만 사용 — Claude는 수동 트리거로만) ──
    ai_briefing = None
    try:
        cached_brief = (await db.execute(text(
            "SELECT data, created_at FROM analysis_cache "
            "WHERE tenant_id = :tid AND election_id = :eid AND cache_type = 'ai_briefing' "
            "ORDER BY created_at DESC LIMIT 1"
        ), {"tid": str(tid), "eid": str(election_id)})).first()
        if cached_brief:
            import json as _json
            ai_briefing = _json.loads(cached_brief[0]) if isinstance(cached_brief[0], str) else cached_brief[0]
            ai_briefing["cached"] = True
            ai_briefing["cached_at"] = cached_brief[1].isoformat() if cached_brief[1] else None
    except:
        pass

    if not ai_briefing:
        # Claude 호출 없이 규칙 기반 빠른 브리핑만
        ai_briefing = _generate_rule_briefing(
            our.name if our else "", news_by_candidate, score_board, neg_list,
        )

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

    return {
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
    }


def _generate_rule_briefing(our_name: str, news_by_cand: list, scores: list, neg_news: list) -> dict:
    """규칙 기반 빠른 브리핑 (Claude 호출 없음, 즉시 반환)."""
    crises, opportunities, todos = [], [], []
    our_news = next((n for n in news_by_cand if n.get("is_ours")), None)
    our_rank = next((i + 1 for i, s in enumerate(scores) if s.get("is_ours")), 0)

    if neg_news:
        for nn in neg_news[:2]:
            if nn.get("candidate") == our_name:
                crises.append(f"부정뉴스: {nn['title'][:40]}")
    if our_news and our_news.get("count", 0) == 0:
        crises.append("뉴스 노출 0건 — 긴급 대응 필요")
    if our_rank > 1 and scores:
        crises.append(f"미디어 노출 {our_rank}위 — {scores[0]['name']} 대비 열세")

    for n in news_by_cand:
        if not n.get("is_ours") and n.get("negative", 0) >= 3:
            opportunities.append(f"{n['name']} 부정뉴스 {n['negative']}건 — 공략 가능")
    if our_news and our_news.get("positive", 0) > 0:
        opportunities.append(f"긍정 뉴스 {our_news['positive']}건 — SNS 확산 활용")

    if our_rank > 1:
        todos.append("보도자료/인터뷰로 뉴스 노출 확대")
    if our_news and our_news.get("negative", 0) > 0:
        todos.append("부정 뉴스 해명 자료 준비")
    if not todos:
        todos.append("현재 모니터링 지속")

    return {
        "rank": our_rank, "rank_total": len(scores),
        "crises": crises[:3], "opportunities": opportunities[:3], "todos": todos[:3],
        "ai_generated": False,
    }


@router.post("/{election_id}/refresh-briefing")
async def refresh_ai_briefing(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """AI 브리핑 수동 재생성 (Claude 호출)."""
    from app.common.election_access import get_election_tenant_ids, get_our_candidate_id

    tid = user["tenant_id"]
    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id = await get_our_candidate_id(db, tid, election_id)

    # 데이터 수집
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

    survey_list = []
    neg_list = []

    briefing = await _generate_ai_briefing(
        our.name if our else "", news_by_cand, score_board, neg_list, survey_list,
    )

    # 캐시 저장
    try:
        import json as _json, uuid as _uuid
        await db.execute(text(
            "INSERT INTO analysis_cache (id, tenant_id, election_id, cache_type, data, created_at) "
            "VALUES (:id, :tid, :eid, 'ai_briefing', :data, NOW()) "
            "ON CONFLICT ON CONSTRAINT uq_analysis_cache_v2 DO UPDATE SET data = EXCLUDED.data, created_at = NOW()"
        ), {
            "id": str(_uuid.uuid4()), "tid": str(tid), "eid": str(election_id),
            "data": _json.dumps(briefing, ensure_ascii=False, default=str),
        })
        await db.commit()
    except:
        pass

    return briefing


async def _generate_ai_briefing(our_name: str, news_by_cand: list, scores: list, neg_news: list, surveys: list) -> dict:
    """Claude AI 기반 일일 브리핑 생성."""
    import asyncio
    import shutil

    our_score = next((s for s in scores if s["is_ours"]), None)
    our_news = next((n for n in news_by_cand if n["is_ours"]), None)
    our_rank = next((i + 1 for i, s in enumerate(scores) if s["is_ours"]), 0)

    # 팩트시트 구성
    factsheet = f"[오늘의 선거 현황 팩트시트]\n"
    factsheet += f"우리 후보: {our_name}\n"
    factsheet += f"현재 순위: {our_rank}위 / {len(scores)}명\n\n"

    factsheet += "[후보별 미디어 현황]\n"
    for s in scores:
        marker = " ★(우리)" if s["is_ours"] else ""
        factsheet += f"- {s['name']}{marker}: 뉴스 {s['news']}건, 긍정률 {s['sentiment_rate']}%, 커뮤니티 {s['community']}건, 유튜브 {s.get('youtube_views', 0)}조회\n"

    if neg_news:
        factsheet += f"\n[부정 뉴스 {len(neg_news)}건]\n"
        for nn in neg_news[:5]:
            factsheet += f"- [{nn['candidate']}] {nn['title'][:50]}\n"

    if surveys:
        factsheet += f"\n[최근 여론조사 {len(surveys)}건]\n"
        for sv in surveys[:3]:
            results_str = ", ".join(f"{k}: {v}" for k, v in (sv.get("results") or {}).items() if isinstance(v, (int, float)))
            factsheet += f"- {sv.get('org', '')} ({sv.get('date', '')}): {results_str[:100]}\n"

    # Claude AI 호출
    claude_path = shutil.which("claude")
    if claude_path:
        prompt = (
            f"{factsheet}\n\n"
            f"위 데이터를 바탕으로 선거 캠프 매니저에게 오늘의 브리핑을 작성하세요.\n"
            f"반드시 아래 JSON 형식으로만 답변하세요 (다른 텍스트 없이):\n"
            f'{{"crises": ["위기1", "위기2"], "opportunities": ["기회1", "기회2"], "todos": ["할일1", "할일2"]}}\n\n'
            f"규칙:\n"
            f"- crises: 지금 즉시 대응해야 할 위험 (최대 3개, 없으면 빈 배열)\n"
            f"- opportunities: 활용할 수 있는 기회 (최대 3개)\n"
            f"- todos: 오늘 구체적으로 해야 할 행동 (최대 3개)\n"
            f"- 각 항목은 구체적이고 실행 가능하게, 한국어로\n"
            f"- 데이터에 근거한 내용만 포함"
        )

        try:
            proc = await asyncio.create_subprocess_exec(
                claude_path, "-p", prompt,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
            if proc.returncode == 0 and stdout:
                import json
                text = stdout.decode("utf-8").strip()
                # JSON 부분만 추출
                start = text.find("{")
                end = text.rfind("}") + 1
                if start >= 0 and end > start:
                    result = json.loads(text[start:end])
                    return {
                        "rank": our_rank,
                        "rank_total": len(scores),
                        "crises": result.get("crises", [])[:3],
                        "opportunities": result.get("opportunities", [])[:3],
                        "todos": result.get("todos", [])[:3],
                        "ai_generated": True,
                    }
        except Exception as e:
            pass  # fallback

    # Claude 불가 시 규칙 기반 fallback
    crises, opportunities, todos = [], [], []

    if neg_news:
        for nn in neg_news[:2]:
            if nn["candidate"] == our_name:
                crises.append(f"부정뉴스 감지: {nn['title'][:40]}")
    if our_news and our_news["count"] == 0:
        crises.append("뉴스 노출 0건 — 긴급 대응 필요")
    if our_rank > 1 and scores:
        crises.append(f"미디어 노출 {our_rank}위 — {scores[0]['name']} 대비 열세")

    for n in news_by_cand:
        if not n["is_ours"] and n["negative"] >= 3:
            opportunities.append(f"{n['name']} 부정뉴스 {n['negative']}건 — 공략 가능")
    if our_news and our_news["positive"] > 0:
        opportunities.append(f"긍정 뉴스 {our_news['positive']}건 — SNS 확산 활용")

    if our_rank > 1:
        todos.append("보도자료/인터뷰로 뉴스 노출 확대")
    if our_news and our_news["negative"] > 0:
        todos.append("부정 뉴스 해명 자료 준비")
    if not surveys:
        todos.append("최근 여론조사 결과 시스템에 등록")
    if not todos:
        todos.append("현재 모니터링 지속")

    return {
        "rank": our_rank,
        "rank_total": len(scores),
        "crises": crises[:3],
        "opportunities": opportunities[:3],
        "todos": todos[:3],
        "ai_generated": False,
    }


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
    tid = user["tenant_id"]
    from app.common.election_access import get_election_tenant_ids, get_our_candidate_id
    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id = await get_our_candidate_id(db, tid, election_id)
    since = date.today() - timedelta(days=days)
    yesterday = date.today() - timedelta(days=1)

    candidates_q = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id, Candidate.tenant_id.in_(all_tids), Candidate.enabled == True
        ).order_by(Candidate.priority)
    )).scalars().all()

    from app.elections.models import YouTubeVideo

    result = []
    for c in sorted(candidates_q, key=lambda x: (0 if x.is_our_candidate else 1, x.priority)):
        # 뉴스
        news_q = await db.execute(
            select(func.count(NewsArticle.id),
                   func.sum(func.cast(NewsArticle.sentiment == "positive", Integer)),
                   func.sum(func.cast(NewsArticle.sentiment == "negative", Integer)),
                   ).where(
                NewsArticle.candidate_id == c.id,
                func.date(NewsArticle.collected_at) >= since,
            )
        )
        news_row = news_q.one()
        news_count = news_row[0] or 0
        news_pos = news_row[1] or 0
        news_neg = news_row[2] or 0

        # 어제 뉴스
        news_yesterday_q = await db.execute(
            select(func.count(NewsArticle.id)).where(
                NewsArticle.candidate_id == c.id,
                func.date(NewsArticle.collected_at) == yesterday,
            )
        )
        news_yesterday = news_yesterday_q.scalar() or 0

        # 유튜브
        yt_q = await db.execute(
            select(func.count(YouTubeVideo.id),
                   func.sum(YouTubeVideo.views),
                   func.sum(YouTubeVideo.likes),
                   func.sum(YouTubeVideo.comments_count),
                   ).where(
                YouTubeVideo.candidate_id == c.id,
                func.date(YouTubeVideo.collected_at) >= since,
            )
        )
        yt_row = yt_q.one()
        yt_count = yt_row[0] or 0
        yt_views = yt_row[1] or 0
        yt_likes = yt_row[2] or 0
        yt_comments = yt_row[3] or 0

        # 커뮤니티
        cm_q = await db.execute(
            select(func.count(CommunityPost.id),
                   func.sum(func.cast(CommunityPost.sentiment == "positive", Integer)),
                   func.sum(func.cast(CommunityPost.sentiment == "negative", Integer)),
                   ).where(
                CommunityPost.candidate_id == c.id,
                func.date(CommunityPost.collected_at) >= since,
            )
        )
        cm_row = cm_q.one()
        cm_count = cm_row[0] or 0
        cm_pos = cm_row[1] or 0
        cm_neg = cm_row[2] or 0

        # 종합 점수 (뉴스30% + 유튜브30% + 커뮤니티20% + 감성20%)
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

    # 전체 채널별 합계
    channel_totals = {
        "news": sum(r["news"]["count"] for r in result),
        "youtube": sum(r["youtube"]["count"] for r in result),
        "youtube_views": sum(r["youtube"]["views"] for r in result),
        "community": sum(r["community"]["count"] for r in result),
    }

    return {
        "candidates": result,
        "channel_totals": channel_totals,
        "period": f"최근 {days}일",
    }


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
    tid = user["tenant_id"]
    from app.common.election_access import get_election_tenant_ids
    all_tids = await get_election_tenant_ids(db, election_id)
    since = date.today() - timedelta(days=days)

    candidates_q = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id, Candidate.tenant_id.in_(all_tids), Candidate.enabled == True
        ).order_by(Candidate.priority)
    )).scalars().all()

    from collections import Counter

    result = []
    all_issues: Counter = Counter()
    platform_totals: Counter = Counter()

    for c in sorted(candidates_q, key=lambda x: (0 if x.is_our_candidate else 1, x.priority)):
        # published_at 우선 필터, 없으면 collected_at — 옛 게시글 제외
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

        # 감성 분포
        sent = {"positive": 0, "negative": 0, "neutral": 0}
        for p in posts:
            s = p.sentiment or "neutral"
            if s in sent:
                sent[s] += 1

        # 플랫폼별
        platforms: Counter = Counter()
        for p in posts:
            platforms[p.platform or "기타"] += 1
            platform_totals[p.platform or "기타"] += 1

        # 이슈 카테고리별
        issues: Counter = Counter()
        for p in posts:
            if p.issue_category:
                issues[p.issue_category] += 1
                all_issues[p.issue_category] += 1

        # 최근 게시글 (published_at 기준 최신순)
        hot_posts = sorted(posts, key=lambda p: (
            p.published_at.isoformat() if p.published_at else (p.collected_at.isoformat() if p.collected_at else '')
        ), reverse=True)[:10]

        # 일별 추이 (최근 7일)
        from collections import defaultdict
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

    return {
        "candidates": result,
        "total_issues": dict(all_issues.most_common(15)),
        "platform_summary": dict(platform_totals),
        "period": f"최근 {days}일",
    }


@router.get("/{election_id}/youtube-data")
async def get_youtube_data(
    election_id: UUID,
    user: CurrentUser,
    days: int = Query(30, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """유튜브 데이터 — 후보별 영상 + 감성 + 통계 + 채널분석 + 위험영상 (기간 필터)."""
    tid = user["tenant_id"]
    from app.common.election_access import get_election_tenant_ids
    all_tids = await get_election_tenant_ids(db, election_id)
    since = date.today() - timedelta(days=days)

    candidates = (await db.execute(
        select(Candidate).where(Candidate.election_id == election_id, Candidate.tenant_id.in_(all_tids), Candidate.enabled == True)
        .order_by(Candidate.priority)
    )).scalars().all()

    from app.elections.models import YouTubeVideo
    from app.elections.history_models import YouTubeComment
    from collections import Counter

    result = []
    all_channels: dict[str, Counter] = {}  # channel -> {candidate: count}
    danger_videos = []

    for c in sorted(candidates, key=lambda x: (0 if x.is_our_candidate else 1, x.priority)):
        # published_at 우선, 없으면 collected_at으로 필터
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

        # 감성 분포
        sent_counts = {"positive": 0, "negative": 0, "neutral": 0}
        for v in videos:
            s = v.sentiment or "neutral"
            if s in sent_counts:
                sent_counts[s] += 1

        # 참여율 (engagement rate)
        engagement_rate = round((total_likes + total_comments) / max(total_views, 1) * 100, 2)

        # Shorts vs 일반 (제목에 #shorts 포함 여부로 구분)
        shorts = [v for v in videos if v.title and ('#shorts' in v.title.lower() or '#short' in v.title.lower())]
        regulars = [v for v in videos if v not in shorts]

        # 부정 + 조회수 5000+ 영상 분류 (is_ours 플래그로 우리/경쟁자 구분)
        # - is_ours=true → "우리 후보 위기" (defend)
        # - is_ours=false → "공격 기회" (attack)
        for v in videos:
            if (v.views or 0) >= 5000 and v.sentiment == "negative":
                danger_videos.append({
                    "video_id": v.video_id,
                    "title": v.title,
                    "channel": v.channel,
                    "views": v.views,
                    "candidate": c.name,
                    "is_ours": bool(c.is_our_candidate),
                    "category": "우리 위기" if c.is_our_candidate else "경쟁자 리스크",
                    "published_at": v.published_at.strftime("%Y-%m-%d") if v.published_at else None,
                    "thumbnail_url": v.thumbnail_url,
                })

        # 채널 집계
        for v in videos:
            ch = v.channel or "알 수 없음"
            if ch not in all_channels:
                all_channels[ch] = Counter()
            all_channels[ch][c.name] += 1

        # 댓글 감성
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
                "video_id": v.video_id,
                "title": v.title,
                "channel": v.channel,
                "views": v.views or 0,
                "likes": v.likes or 0,
                "comments_count": v.comments_count or 0,
                "sentiment": v.sentiment or "neutral",
                "published_at": v.published_at.strftime("%Y-%m-%d") if v.published_at else None,
                "thumbnail_url": v.thumbnail_url,
                "is_short": bool(v.title and ('#shorts' in v.title.lower() or '#short' in v.title.lower())),
            } for v in videos],
        })

    # 채널 분석 (상위 15개 채널)
    channel_analysis = []
    for ch, counts in sorted(all_channels.items(), key=lambda x: sum(x[1].values()), reverse=True)[:15]:
        channel_analysis.append({
            "channel": ch,
            "total": sum(counts.values()),
            "candidates": dict(counts),
        })

    return {
        "candidates": result,
        "channel_analysis": channel_analysis,
        "danger_videos": danger_videos,
        "period": f"최근 {days}일",
    }


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
