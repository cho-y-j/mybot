"""
ElectionPulse - Analysis API
대시보드 + 분석 페이지용 실데이터 엔드포인트
"""
from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func, or_, text
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
    db: AsyncSession = Depends(get_db),
):
    """경쟁자 대비 갭 분석 — 우리가 부족한 영역, 우위 영역, AI 요약."""
    from app.analysis.competitor import analyze_competitor_gaps

    tid = user["tenant_id"]
    result = await analyze_competitor_gaps(db, tid, str(election_id), days=days)
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


@router.get("/{election_id}/overview")
async def analysis_overview(
    election_id: UUID,
    user: CurrentUser,
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """대시보드 종합 데이터 — 실데이터 100%."""
    tid = user["tenant_id"]
    today = date.today()
    since = today - timedelta(days=days)

    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
    candidates = (await db.execute(
        select(Candidate).where(Candidate.election_id == election_id, Candidate.tenant_id == tid, Candidate.enabled == True)
        .order_by(Candidate.priority)
    )).scalars().all()

    # 우리 후보가 항상 첫 번째
    candidates = sorted(candidates, key=lambda c: (0 if c.is_our_candidate else 1, c.priority))
    our = next((c for c in candidates if c.is_our_candidate), None)
    d_day = (election.election_date - today).days if election else 0

    # ── 후보별 뉴스 + 감성 ──
    news_by_candidate = []
    total_news = 0
    total_positive = 0
    total_negative = 0

    for c in candidates:
        cnt = (await db.execute(select(func.count()).where(
            NewsArticle.candidate_id == c.id, func.date(NewsArticle.collected_at) >= since
        ))).scalar() or 0
        pos = (await db.execute(select(func.count()).where(
            NewsArticle.candidate_id == c.id, func.date(NewsArticle.collected_at) >= since, NewsArticle.sentiment == "positive"
        ))).scalar() or 0
        neg = (await db.execute(select(func.count()).where(
            NewsArticle.candidate_id == c.id, func.date(NewsArticle.collected_at) >= since, NewsArticle.sentiment == "negative"
        ))).scalar() or 0

        news_by_candidate.append({
            "name": c.name, "is_ours": c.is_our_candidate, "party": c.party,
            "count": cnt, "positive": pos, "negative": neg, "neutral": cnt - pos - neg,
        })
        total_news += cnt
        total_positive += pos
        total_negative += neg

    # 우리 후보 긍정률
    our_data = next((n for n in news_by_candidate if n["is_ours"]), None)
    our_pos_rate = round(our_data["positive"] / our_data["count"] * 100) if our_data and our_data["count"] > 0 else 0

    # ── 최근 뉴스 (실데이터) ──
    recent_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(NewsArticle.tenant_id == tid, NewsArticle.election_id == election_id)
        .order_by(NewsArticle.collected_at.desc()).limit(10)
    )).all()

    news_list = [{
        "title": n.title, "url": n.url, "source": n.source,
        "summary": n.summary, "sentiment": n.sentiment,
        "sentiment_score": n.sentiment_score, "candidate": cname,
        "date": (n.published_at or n.collected_at).strftime("%Y-%m-%d") if (n.published_at or n.collected_at) else None,
        "collected_at": n.collected_at.isoformat() if n.collected_at else None,
    } for n, cname in recent_news]

    # ── 여론조사 (해당 지역 데이터) ──
    survey_conditions = [Survey.tenant_id == tid]
    if election:
        survey_conditions.append(Survey.region_sido == election.region_sido)
    survey_conditions.append(Survey.source_url == 'chungbuk_prototype')
    survey_conditions.append(Survey.source_url.like('pdf/%'))

    surveys = (await db.execute(
        select(Survey).where(or_(*survey_conditions))
        .order_by(Survey.survey_date.desc()).limit(10)
    )).scalars().all()

    survey_list = [{
        "org": s.survey_org, "date": s.survey_date.isoformat() if s.survey_date else None,
        "sample_size": s.sample_size, "results": s.results if isinstance(s.results, dict) else {},
    } for s in surveys]

    # ── 알림 (실데이터 기반) ──
    alerts = []
    if our_data:
        max_news = max((n["count"] for n in news_by_candidate), default=0)
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
            "d_day": d_day,
            "total_news": total_news,
            "our_pos_rate": our_pos_rate,
            "negative_alerts": total_negative,
            "survey_count": len(surveys),
        },
        "news_by_candidate": news_by_candidate,
        "recent_news": news_list,
        "surveys": survey_list,
        "alerts": alerts,
        "our_candidate": our.name if our else None,
    }


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
            SearchTrend.tenant_id == tid,
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
