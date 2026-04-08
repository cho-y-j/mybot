"""
ElectionPulse - 일일 보고서 생성기
핵심 5개 섹션만 — 짧고 빠르게. 상세는 대시보드에서.
"""
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Election, Candidate, NewsArticle, SearchTrend, Survey,
)
import structlog

logger = structlog.get_logger()


async def generate_daily_report(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
) -> dict:
    """
    일일 보고서 생성 (핵심 5섹션).
    Returns: {"text": str, "sections": dict}
    """
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"text": "선거 정보 없음", "sections": {}}

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == tenant_id,
            Candidate.enabled == True,
        ).order_by(Candidate.priority)
    )).scalars().all()

    our = next((c for c in candidates if c.is_our_candidate), None)
    today = date.today()
    yesterday = today - timedelta(days=1)
    d_day = (election.election_date - today).days
    now = datetime.now(timezone(timedelta(hours=9)))

    lines = []
    lines.append(f"📋 [D-{d_day}] 일일 보고서")
    lines.append(f"{today.isoformat()} {now.strftime('%H:%M')}")
    lines.append("=" * 28)

    # ── 1. 오늘 현황 요약 ──
    lines.append("")
    lines.append("📊 <b>[1. 오늘 현황]</b>")

    total_today = 0
    cand_stats = []
    for c in candidates:
        today_cnt = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == c.id,
                func.date(NewsArticle.collected_at) == today,
            )
        )).scalar() or 0
        yesterday_cnt = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == c.id,
                func.date(NewsArticle.collected_at) == yesterday,
            )
        )).scalar() or 0

        pos = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == c.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "positive",
            )
        )).scalar() or 0
        neg = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == c.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "negative",
            )
        )).scalar() or 0

        change = today_cnt - yesterday_cnt
        change_str = f"{'↑' if change > 0 else '↓' if change < 0 else '→'}{abs(change)}" if change != 0 else "→"
        marker = " ⭐" if c.is_our_candidate else ""
        cand_stats.append({
            "name": c.name, "today": today_cnt, "change": change,
            "pos": pos, "neg": neg, "is_ours": c.is_our_candidate,
        })
        lines.append(f"  {c.name}{marker}: {today_cnt}건({change_str}) 긍정{pos}/부정{neg}")
        total_today += today_cnt

    lines.append(f"  ─ 합계: {total_today}건")

    # ── 2. 주요 뉴스 TOP 5 ──
    lines.append("")
    lines.append("📰 <b>[2. 주요 뉴스]</b>")

    recent = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id == tenant_id,
            func.date(NewsArticle.collected_at) == today,
        )
        .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
        .limit(5)
    )).all()

    if recent:
        for news, cand_name in recent:
            emoji = {"positive": "🟢", "negative": "🔴"}.get(news.sentiment, "⚪")
            lines.append(f"  {emoji}[{cand_name}] {news.title[:45]}")
    else:
        lines.append("  (오늘 수집된 뉴스 없음)")

    # 부정 뉴스 별도 강조
    neg_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id == tenant_id,
            func.date(NewsArticle.collected_at) == today,
            NewsArticle.sentiment == "negative",
        )
    )).all()

    if neg_news:
        lines.append(f"  🚨 부정뉴스 {len(neg_news)}건:")
        for news, cname in neg_news[:3]:
            lines.append(f"    🔴 [{cname}] {news.title[:40]}")

    # ── 3. 검색 트렌드 변화 ──
    lines.append("")
    lines.append("📈 <b>[3. 검색 트렌드]</b>")

    trends = (await db.execute(
        select(SearchTrend)
        .where(SearchTrend.tenant_id == tenant_id)
        .order_by(SearchTrend.checked_at.desc())
        .limit(10)
    )).scalars().all()

    if trends:
        for t in trends[:5]:
            lines.append(f"  {t.keyword}: {t.relative_volume or 0:.1f}")
    else:
        lines.append("  (트렌드 데이터 수집 필요 — 대시보드에서 '지금 업데이트')")

    # ── 4. 위기/기회 알림 ──
    lines.append("")
    lines.append("⚡ <b>[4. 위기/기회]</b>")

    alerts = []
    if our:
        our_stat = next((s for s in cand_stats if s["is_ours"]), None)
        max_today = max((s["today"] for s in cand_stats), default=0)

        if our_stat and max_today > 0:
            ratio = our_stat["today"] / max_today * 100
            if ratio < 30:
                alerts.append(f"🔴 {our.name} 노출 심각 부족 ({ratio:.0f}%)")
            elif ratio < 60:
                alerts.append(f"🟡 {our.name} 노출 부족 ({ratio:.0f}%)")

        if our_stat and our_stat["neg"] > 0:
            alerts.append(f"🔴 {our.name} 부정뉴스 {our_stat['neg']}건 — 대응 필요")

    for s in cand_stats:
        if not s["is_ours"] and s["neg"] >= 3:
            alerts.append(f"💡 {s['name']} 부정뉴스 {s['neg']}건 — 약점 공략 가능")

    if alerts:
        for a in alerts:
            lines.append(f"  {a}")
    else:
        lines.append("  특이사항 없음")

    # ── 5. 불편한 진실 + 할 일 ──
    lines.append("")
    lines.append("💀 <b>[5. 불편한 진실]</b>")

    if our:
        our_total = sum(1 for s in cand_stats if s["is_ours"] for _ in range(s["today"]))
        all_total = sum(s["today"] for s in cand_stats)
        if all_total > 0:
            pct = our_total / all_total * 100
            if pct < 30:
                lines.append(f"  ⚠️ {our.name} 뉴스 비중 {pct:.0f}% — 경쟁자 대비 심각 부족")
            elif pct < 50:
                lines.append(f"  ⚠️ {our.name} 뉴스 비중 {pct:.0f}% — 노출 강화 필요")
            else:
                lines.append(f"  ✅ {our.name} 뉴스 비중 {pct:.0f}% — 양호")

        # 최근 여론조사 (해당 테넌트 + 해당 선거 지역)
        survey_q = select(Survey).where(
            Survey.tenant_id == tenant_id,
        )
        if election and election.region_sido:
            from sqlalchemy import or_
            survey_q = survey_q.where(or_(
                Survey.election_id == election_id,
                Survey.region_sido == election.region_sido,
            ))
        latest_survey = (await db.execute(
            survey_q.order_by(Survey.survey_date.desc()).limit(1)
        )).scalar_one_or_none()

        if latest_survey and latest_survey.results:
            r = latest_survey.results if isinstance(latest_survey.results, dict) else {}
            our_rate = r.get(our.name, 0)
            max_rate = max(r.values()) if r else 0
            if our_rate < max_rate:
                leader = max(r, key=r.get)
                lines.append(f"  ⚠️ 여론조사 {our.name} {our_rate}% vs {leader} {max_rate}% — {max_rate - our_rate:.1f}%p 뒤처짐")

    lines.append("")
    lines.append("=" * 28)
    lines.append("ElectionPulse | 상세분석은 대시보드에서")

    report_text = "\n".join(lines)

    return {
        "text": report_text,
        "sections": {
            "summary": cand_stats,
            "alerts": alerts,
            "news_count": total_today,
            "neg_count": len(neg_news) if neg_news else 0,
        },
    }
