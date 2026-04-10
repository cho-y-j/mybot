"""
ElectionPulse - Telegram Report Service
스케줄 실행 결과를 텔레그램으로 자동 보고.

3가지 브리핑 형식:
- morning: 오전 브리핑 (간결, 5개 섹션)
- afternoon: 오후 브리핑 (오전 대비 변화)
- daily: 일일 보고서 (종합 요약)

모든 보고서에 실제 기사 URL 포함, 경쟁자 갭 하이라이트, 위기 경보 포함.
"""
from datetime import datetime, timezone, date, timedelta
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Election, Candidate, NewsArticle, CommunityPost,
    YouTubeVideo, SearchTrend, TelegramConfig, Report,
)
from app.telegram_service.bot import TelegramBot
import structlog

logger = structlog.get_logger()

KST = timezone(timedelta(hours=9))


async def send_collection_report(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    collect_type: str,
    items_collected: int,
):
    """수집 완료 후 간단한 결과 알림."""
    type_labels = {
        "news": "뉴스", "community": "커뮤니티", "youtube": "유튜브",
        "trends": "검색 트렌드", "all": "전체",
    }
    label = type_labels.get(collect_type, collect_type)
    now = datetime.now(KST)

    text = (
        f"📊 <b>[{label} 수집 완료]</b>\n"
        f"시간: {now.strftime('%H:%M')}\n"
        f"수집: {items_collected}건\n"
    )

    await _send_to_all_recipients(db, tenant_id, text, "news")


async def generate_briefing_text(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    briefing_type: str = "daily",
) -> str | None:
    """
    브리핑 보고서 텍스트만 생성 (텔레그램 발송 없음).
    briefing_type: morning | afternoon | daily
    Returns: 보고서 텍스트
    """
    # 데이터 수집
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return None

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
    now = datetime.now(KST)

    # 브리핑 타입별 생성
    if briefing_type == "morning":
        report_text = await _build_morning_briefing(
            db, tenant_id, election_id, election, candidates, our, d_day, now, today, yesterday,
        )
    elif briefing_type == "afternoon":
        report_text = await _build_afternoon_briefing(
            db, tenant_id, election_id, election, candidates, our, d_day, now, today,
        )
    else:
        report_text = await _build_daily_report(
            db, tenant_id, election_id, election, candidates, our, d_day, now, today, yesterday,
        )

    return report_text


async def send_briefing_report(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    briefing_type: str = "daily",
) -> str | None:
    """
    브리핑 보고서 생성 + 텔레그램 발송.
    briefing_type: morning | afternoon | daily
    Returns: 보고서 텍스트
    """
    report_text = await generate_briefing_text(db, tenant_id, election_id, briefing_type)
    if not report_text:
        return None

    # 텔레그램 발송
    config = await _get_telegram_config(db, tenant_id)
    if config:
        sent = await _send_to_all_recipients(db, tenant_id, report_text, "briefing")
        logger.info("briefing_sent", tenant_id=tenant_id, type=briefing_type, recipients=sent)

    return report_text


# ──────────────── MORNING BRIEFING ──────────────────────────────

async def _build_morning_briefing(
    db, tenant_id, election_id, election, candidates, our, d_day, now, today, yesterday,
) -> str:
    """
    오전 브리핑: 간결한 5개 섹션.
    1. 오늘의 핵심 수치
    2. 주요 뉴스 헤드라인 + URL
    3. 경쟁자 갭 분석
    4. 위기/기회 경보
    5. 오전 액션 아이템
    """
    lines = [
        f"<b>☀️ [D-{d_day}] 오전 브리핑</b>",
        f"CampAI | {today.isoformat()} {now.strftime('%H:%M')}",
        "",
    ]

    # ── 핵심 수치 먼저 수집 (한 줄 판정용) ──
    cand_data = []
    for cand in candidates:
        today_cnt = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
            )
        )).scalar() or 0
        yest_cnt = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == yesterday,
            )
        )).scalar() or 0
        pos = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "positive",
            )
        )).scalar() or 0
        neg = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "negative",
            )
        )).scalar() or 0

        marker = " ⭐" if cand.is_our_candidate else ""
        change = today_cnt - yest_cnt
        arrow = "↑" if change > 0 else ("↓" if change < 0 else "→")
        lines.append(
            f"  {cand.name}{marker}: {today_cnt}건({arrow}{abs(change)}) "
            f"긍정{pos}/부정{neg}"
        )
        cand_data.append({
            "name": cand.name, "is_ours": cand.is_our_candidate,
            "today": today_cnt, "yest": yest_cnt, "pos": pos, "neg": neg,
            "id": cand.id,
        })

    # ── 한 줄 판정 ──
    our_data = next((c for c in cand_data if c["is_ours"]), None)
    if our_data and cand_data:
        max_today = max(c["today"] for c in cand_data)
        our_rank = sorted(cand_data, key=lambda x: -x["today"]).index(our_data) + 1 if our_data in sorted(cand_data, key=lambda x: -x["today"]) else 0
        our_rank = sum(1 for c in cand_data if c["today"] > our_data["today"]) + 1

        if our_data["neg"] >= 3:
            verdict = f"⚠️ 부정뉴스 {our_data['neg']}건 감지 — 즉시 대응 필요"
        elif max_today > 0 and our_data["today"] / max_today < 0.3:
            verdict = f"🔴 미디어 노출 심각 부족 ({our_rank}위/{len(cand_data)}명)"
        elif our_data["today"] == 0:
            verdict = "🔴 오늘 뉴스 노출 0건 — 긴급"
        elif our_rank == 1:
            verdict = "✅ 미디어 노출 1위 유지 중"
        else:
            verdict = f"📊 미디어 노출 {our_rank}위/{len(cand_data)}명"

        lines.append(f"<b>{verdict}</b>")
        lines.append("")

    # ── 1. 핵심 수치 ──
    lines.append("<b>[핵심 수치]</b>")
    for cd in sorted(cand_data, key=lambda x: -x["today"]):
        marker = " ⭐" if cd["is_ours"] else ""
        change = cd["today"] - cd["yest"]
        arrow = "↑" if change > 0 else ("↓" if change < 0 else "→")
        lines.append(f"  {cd['name']}{marker}: {cd['today']}건({arrow}{abs(change)}) 긍{cd['pos']}/부{cd['neg']}")
    lines.append("")

    # ── 2. 주요 뉴스 + URL ──
    lines.append("<b>[주요 뉴스]</b>")
    recent_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id == tenant_id,
            NewsArticle.election_id == election_id,
        )
        .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
        .limit(5)
    )).all()

    for news, cand_name in recent_news:
        emoji = {"positive": "🟢", "negative": "🔴", "neutral": "⚪"}.get(news.sentiment, "⚪")
        lines.append(f"  {emoji} [{cand_name}] {news.title[:60]}")
        if news.url:
            lines.append(f"  {news.url}")
    if not recent_news:
        lines.append("  수집된 뉴스 없음")
    lines.append("")

    # ── 3. 경쟁자 갭 분석 ──
    lines.append("<b>[경쟁자 동향]</b>")
    our_data = next((d for d in cand_data if d["is_ours"]), None)
    if our_data:
        max_news = max((d["today"] for d in cand_data), default=0)
        if max_news > 0:
            ratio = our_data["today"] / max_news * 100
            leader = max(cand_data, key=lambda x: x["today"])
            if ratio < 100 and leader["name"] != our_data["name"]:
                lines.append(
                    f"  ⚠️ 뉴스 노출: {our_data['name']} {our_data['today']}건 "
                    f"vs {leader['name']} {leader['today']}건 ({ratio:.0f}%)"
                )
            else:
                lines.append(f"  ✅ {our_data['name']} 뉴스 노출 선두 ({our_data['today']}건)")

        # 부정 뉴스 비교
        for d in cand_data:
            if d["is_ours"] and d["neg"] > 0:
                lines.append(f"  🔴 {d['name']} 부정 뉴스 {d['neg']}건 — 주의 필요")
    else:
        lines.append("  우리 후보 미지정")
    lines.append("")

    # ── 4. 위기/기회 경보 ──
    lines.append("<b>[위기/기회]</b>")
    neg_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id == tenant_id,
            NewsArticle.election_id == election_id,
            NewsArticle.sentiment == "negative",
            func.date(NewsArticle.collected_at) == today,
        )
        .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
        .limit(3)
    )).all()

    if neg_news:
        for n, cname in neg_news:
            lines.append(f"  🚨 [{cname}] {n.title[:50]}")
            if n.url:
                lines.append(f"  {n.url}")
    else:
        lines.append("  특이사항 없음")
    lines.append("")

    # ── 5. 오전 액션 ──
    lines.append("<b>[오늘 할 일]</b>")
    if our_data and our_data["today"] == 0:
        lines.append("  → 뉴스 노출 전무 — 보도자료 배포 시급")
    elif our_data and our_data["neg"] > our_data["pos"]:
        lines.append("  → 부정 뉴스 우세 — 해명/반박 자료 준비")
    else:
        lines.append("  → 현재 추세 유지, 이슈 선점 기회 모색")

    lines.append("")
    lines.append(f"{'=' * 25}")
    lines.append("ElectionPulse | 객관적 데이터 기반 분석")

    return "\n".join(lines)


# ──────────────── AFTERNOON BRIEFING ────────────────────────────

async def _build_afternoon_briefing(
    db, tenant_id, election_id, election, candidates, our, d_day, now, today,
) -> str:
    """
    오후 브리핑: 오전 대비 변화 포커스.
    1. 수집 현황 (오전 → 현재)
    2. 감성 비교
    3. 신규 뉴스 하이라이트
    4. 부정 뉴스 경보
    5. 핫이슈 / 트렌드
    6. 약점 체크
    7. 전략 방향
    """
    # 오전 cutoff: 오늘 12:00 KST
    morning_cutoff = datetime.combine(today, datetime.min.time().replace(hour=3))  # UTC 03:00 = KST 12:00
    morning_cutoff = morning_cutoff.replace(tzinfo=timezone.utc)

    lines = [
        f"<b>🌤 [D-{d_day}] 오후 브리핑</b>",
        f"{today.isoformat()} {now.strftime('%H:%M')}",
        f"{'=' * 25}",
        "",
    ]

    # ── 1. 수집 현황 ──
    lines.append("<b>[1. 수집 현황]</b>")
    for cand in candidates:
        total_today = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
            )
        )).scalar() or 0

        community_cnt = (await db.execute(
            select(func.count()).where(
                CommunityPost.candidate_id == cand.id,
                func.date(CommunityPost.collected_at) == today,
            )
        )).scalar() or 0

        yt_cnt = (await db.execute(
            select(func.count()).where(
                YouTubeVideo.candidate_id == cand.id,
                func.date(YouTubeVideo.collected_at) == today,
            )
        )).scalar() or 0

        marker = " ⭐" if cand.is_our_candidate else ""
        lines.append(
            f"  {cand.name}{marker}: 뉴스{total_today} 커뮤{community_cnt} 유튜브{yt_cnt}"
        )
    lines.append("")

    # ── 2. 감성 비교 ──
    lines.append("<b>[2. 감성 비교]</b>")
    for cand in candidates:
        pos = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "positive",
            )
        )).scalar() or 0
        neg = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "negative",
            )
        )).scalar() or 0
        total = pos + neg
        ratio = (pos / total * 100) if total > 0 else 0
        bar = "🟢" if ratio > 60 else ("🔴" if ratio < 40 else "⚪")
        marker = " ⭐" if cand.is_our_candidate else ""
        lines.append(f"  {bar} {cand.name}{marker}: 긍정{pos}/부정{neg} ({ratio:.0f}%)")
    lines.append("")

    # ── 3. 오후 신규 뉴스 ──
    lines.append("<b>[3. 오후 신규 뉴스]</b>")
    afternoon_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id == tenant_id,
            NewsArticle.election_id == election_id,
            NewsArticle.collected_at >= morning_cutoff,
        )
        .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
        .limit(5)
    )).all()

    for news, cname in afternoon_news:
        emoji = {"positive": "🟢", "negative": "🔴", "neutral": "⚪"}.get(news.sentiment, "⚪")
        lines.append(f"  {emoji} [{cname}] {news.title[:55]}")
        if news.url:
            lines.append(f"  {news.url}")
    if not afternoon_news:
        lines.append("  오후 신규 뉴스 없음")
    lines.append("")

    # ── 4. 부정 뉴스 경보 ──
    lines.append("<b>[4. 부정 뉴스 경보]</b>")
    neg_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id == tenant_id,
            NewsArticle.election_id == election_id,
            NewsArticle.sentiment == "negative",
            func.date(NewsArticle.collected_at) == today,
        )
        .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
        .limit(3)
    )).all()
    if neg_news:
        for n, cname in neg_news:
            lines.append(f"  🚨 [{cname}] {n.title[:50]}")
            if n.url:
                lines.append(f"  {n.url}")
    else:
        lines.append("  부정 뉴스 없음 ✅")
    lines.append("")

    # ── 5. 트렌드 ──
    lines.append("<b>[5. 검색 트렌드]</b>")
    trends = (await db.execute(
        select(SearchTrend).where(
            SearchTrend.tenant_id == tenant_id,
            SearchTrend.election_id == election_id,
        ).order_by(SearchTrend.checked_at.desc()).limit(6)
    )).scalars().all()
    if trends:
        for t in trends:
            vol = t.relative_volume or t.search_volume or 0
            lines.append(f"  {t.keyword}: {vol:.0f}")
    else:
        lines.append("  트렌드 데이터 없음")
    lines.append("")

    # ── 6. 약점 체크 ──
    if our:
        lines.append("<b>[6. 약점 체크]</b>")
        our_total = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == our.id,
                func.date(NewsArticle.collected_at) == today,
            )
        )).scalar() or 0

        all_total = (await db.execute(
            select(func.count()).where(
                NewsArticle.tenant_id == tenant_id,
                NewsArticle.election_id == election_id,
                func.date(NewsArticle.collected_at) == today,
            )
        )).scalar() or 0

        if all_total > 0:
            share = our_total / all_total * 100
            if share < 30:
                lines.append(f"  ⚠️ 뉴스 점유율 {share:.0f}% — 심각한 노출 부족")
            elif share < 50:
                lines.append(f"  ⚠️ 뉴스 점유율 {share:.0f}% — 경쟁자 대비 부족")
            else:
                lines.append(f"  ✅ 뉴스 점유율 {share:.0f}% — 양호")
        else:
            lines.append("  오늘 수집된 뉴스 없음")
        lines.append("")

    # ── 7. 전략 방향 ──
    lines.append("<b>[7. 전략 방향]</b>")
    lines.append("  → 오후 언론 대응 및 SNS 게시 강화")
    lines.append("  → 부정 이슈 모니터링 지속")
    lines.append("")

    lines.append(f"{'=' * 25}")
    lines.append("ElectionPulse | 객관적 데이터 기반 분석")

    return "\n".join(lines)


# ──────────────── DAILY REPORT ──────────────────────────────────

async def _build_daily_report(
    db, tenant_id, election_id, election, candidates, our, d_day, now, today, yesterday,
) -> str:
    """
    일일 보고서: 종합 요약 (6개 섹션).
    1. 뉴스 종합 현황
    2. 주요 기사 TOP 5 + URL
    3. 커뮤니티/유튜브 동향
    4. 경쟁자 갭 하이라이트
    5. 불편한 진실 (객관성 원칙)
    6. 내일 전략
    """
    lines = [
        f"<b>🌙 [D-{d_day}] 일일 보고서</b>",
        f"{today.isoformat()} {now.strftime('%H:%M')}",
        f"{'=' * 25}",
        "",
    ]

    # ── 1. 뉴스 종합 현황 ──
    lines.append("<b>[1. 뉴스 종합]</b>")
    cand_data = []
    for cand in candidates:
        today_cnt = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
            )
        )).scalar() or 0
        yest_cnt = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == yesterday,
            )
        )).scalar() or 0
        total_all = (await db.execute(
            select(func.count()).where(NewsArticle.candidate_id == cand.id)
        )).scalar() or 0
        pos = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "positive",
            )
        )).scalar() or 0
        neg = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "negative",
            )
        )).scalar() or 0

        marker = " ⭐" if cand.is_our_candidate else ""
        change = today_cnt - yest_cnt
        arrow = "↑" if change > 0 else ("↓" if change < 0 else "→")
        lines.append(
            f"  {cand.name}{marker}: 오늘 {today_cnt}건({arrow}{abs(change)}) "
            f"누적 {total_all}건 | 긍정{pos}/부정{neg}"
        )
        cand_data.append({
            "name": cand.name, "is_ours": cand.is_our_candidate,
            "today": today_cnt, "pos": pos, "neg": neg,
            "total": total_all, "id": cand.id,
        })
    lines.append("")

    # ── 2. 주요 기사 TOP 5 ──
    lines.append("<b>[2. 주요 기사 TOP 5]</b>")
    top_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id == tenant_id,
            NewsArticle.election_id == election_id,
            func.date(NewsArticle.collected_at) == today,
        )
        .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
        .limit(5)
    )).all()

    for i, (news, cname) in enumerate(top_news, 1):
        emoji = {"positive": "🟢", "negative": "🔴", "neutral": "⚪"}.get(news.sentiment, "⚪")
        lines.append(f"  {i}. {emoji} [{cname}] {news.title[:55]}")
        if news.url:
            lines.append(f"     {news.url}")
    if not top_news:
        lines.append("  수집된 뉴스 없음")
    lines.append("")

    # ── 3. 커뮤니티/유튜브 동향 ──
    lines.append("<b>[3. 커뮤니티/유튜브]</b>")
    for cand in candidates:
        comm_cnt = (await db.execute(
            select(func.count()).where(
                CommunityPost.candidate_id == cand.id,
                func.date(CommunityPost.collected_at) == today,
            )
        )).scalar() or 0
        yt_cnt = (await db.execute(
            select(func.count()).where(
                YouTubeVideo.candidate_id == cand.id,
                func.date(YouTubeVideo.collected_at) == today,
            )
        )).scalar() or 0
        yt_views = (await db.execute(
            select(func.coalesce(func.sum(YouTubeVideo.views), 0)).where(
                YouTubeVideo.candidate_id == cand.id,
            )
        )).scalar() or 0

        marker = " ⭐" if cand.is_our_candidate else ""
        lines.append(
            f"  {cand.name}{marker}: 커뮤 {comm_cnt}건 / 유튜브 {yt_cnt}건 ({yt_views:,}회)"
        )
    lines.append("")

    # ── 4. 경쟁자 갭 하이라이트 ──
    lines.append("<b>[4. 경쟁자 갭]</b>")
    our_data = next((d for d in cand_data if d["is_ours"]), None)
    if our_data:
        # 뉴스 노출 비교
        max_cnt = max((d["today"] for d in cand_data), default=0)
        if max_cnt > 0:
            our_share = our_data["today"] / max_cnt * 100
            leader = max(cand_data, key=lambda x: x["today"])
            if leader["name"] != our_data["name"]:
                lines.append(
                    f"  뉴스: {our_data['name']} {our_data['today']}건 vs "
                    f"{leader['name']} {leader['today']}건 (차이 {leader['today'] - our_data['today']}건)"
                )

        # 감성 비교
        for d in cand_data:
            if not d["is_ours"] and d["pos"] > our_data.get("pos", 0):
                lines.append(
                    f"  감성: {d['name']} 긍정 {d['pos']}건 > "
                    f"{our_data['name']} {our_data.get('pos', 0)}건"
                )
    else:
        lines.append("  우리 후보 미지정")
    lines.append("")

    # ── 5. 불편한 진실 (객관성 필수 원칙) ──
    lines.append("<b>[5. 불편한 진실]</b>")
    if our_data:
        all_today = sum(d["today"] for d in cand_data)
        if all_today > 0:
            share = our_data["today"] / all_today * 100
            if share < 30:
                lines.append(f"  🔴 전체 뉴스 중 {our_data['name']} 점유율 {share:.0f}% — 심각 부족")
            elif share < 50:
                lines.append(f"  ⚠️ 전체 뉴스 중 {our_data['name']} 점유율 {share:.0f}% — 강화 필요")
            else:
                lines.append(f"  ✅ 전체 뉴스 중 {our_data['name']} 점유율 {share:.0f}%")

        if our_data["neg"] > 0:
            lines.append(f"  🔴 {our_data['name']} 부정 뉴스 {our_data['neg']}건 발생")

        # 경쟁자 강점 보고
        for d in cand_data:
            if not d["is_ours"] and d["today"] > our_data["today"]:
                lines.append(f"  ⚠️ {d['name']}이(가) 뉴스 노출에서 앞서고 있음")
    else:
        lines.append("  우리 후보 미지정으로 분석 불가")
    lines.append("")

    # ── 6. 내일 전략 ──
    lines.append("<b>[6. 내일 전략]</b>")
    if our_data and our_data["today"] == 0:
        lines.append("  1. 보도자료 즉시 배포 (언론 노출 전무)")
        lines.append("  2. SNS 콘텐츠 집중 발행")
        lines.append("  3. 지역 언론 인터뷰 섭외")
    elif our_data and our_data["neg"] > our_data["pos"]:
        lines.append("  1. 부정 이슈 대응 자료 준비")
        lines.append("  2. 긍정 스토리 발굴 및 배포")
        lines.append("  3. 지지층 결집 SNS 캠페인")
    else:
        lines.append("  1. 현재 노출 추세 유지 강화")
        lines.append("  2. 경쟁자 이슈 선점 기회 포착")
        lines.append("  3. 유권자 관심 이슈 콘텐츠 제작")

    lines.append("")
    lines.append(f"{'=' * 25}")
    lines.append("ElectionPulse | 객관적 데이터 기반 분석")

    return "\n".join(lines)


# ──────────────── CRISIS ALERT FORMAT ───────────────────────────

async def send_crisis_alert(
    db: AsyncSession,
    tenant_id: str,
    alerts: list[dict],
) -> int:
    """
    위기 경보 즉시 발송.
    alerts: [{"level": "critical|warning", "message": str, "action": str, "url": str?}]
    """
    now = datetime.now(KST)
    lines = [
        f"🚨 <b>[긴급 위기 경보]</b>",
        f"{now.strftime('%Y-%m-%d %H:%M')}",
        f"{'=' * 25}",
        "",
    ]

    for i, alert in enumerate(alerts, 1):
        level_emoji = "🔴" if alert.get("level") == "critical" else "⚠️"
        lines.append(f"{level_emoji} <b>경보 {i}.</b> {alert['message']}")
        if alert.get("url"):
            lines.append(f"  {alert['url']}")
        if alert.get("action"):
            lines.append(f"  → 조치: {alert['action']}")
        lines.append("")

    lines.append("<b>[즉시 대응 필요 사항]</b>")
    for alert in alerts:
        if alert.get("action"):
            lines.append(f"  • {alert['action']}")

    lines.append("")
    lines.append(f"{'=' * 25}")
    lines.append("ElectionPulse | 위기 자동 감지")

    text = "\n".join(lines)
    sent = await _send_to_all_recipients(db, tenant_id, text, "alert")
    return sent


# ──────────────── HELPER: SEND TO ALL ───────────────────────────

async def send_alert(
    db: AsyncSession,
    tenant_id: str,
    alert_message: str,
):
    """긴급 알림 발송."""
    config = await _get_telegram_config(db, tenant_id)
    if not config:
        return

    await _send_to_all_recipients(db, tenant_id, f"🚨 <b>[긴급 알림]</b>\n\n{alert_message}", "alert")


async def _send_to_all_recipients(
    db: AsyncSession, tenant_id: str, text: str, filter_type: str = "briefing"
) -> int:
    """모든 활성 수신자에게 메시지 발송. Returns: 발송 성공 수."""
    from app.elections.models import TelegramRecipient

    config = await _get_telegram_config(db, tenant_id)
    if not config:
        return 0

    # 수신 설정에 따라 필터
    query = select(TelegramRecipient).where(
        TelegramRecipient.config_id == config.id,
        TelegramRecipient.is_active == True,
    )
    if filter_type == "news":
        query = query.where(TelegramRecipient.receive_news == True)
    elif filter_type == "briefing":
        query = query.where(TelegramRecipient.receive_briefing == True)
    elif filter_type == "alert":
        query = query.where(TelegramRecipient.receive_alert == True)

    recipients = (await db.execute(query)).scalars().all()
    sent = 0

    for r in recipients:
        bot = TelegramBot(config.bot_token, r.chat_id)
        if await bot.send_message(text):
            sent += 1

    if sent > 0:
        config.last_message_at = datetime.now(timezone.utc)

    logger.info("telegram_sent", tenant_id=tenant_id, type=filter_type, sent=sent, total=len(recipients))
    return sent


async def _get_telegram_config(db: AsyncSession, tenant_id: str) -> TelegramConfig | None:
    result = await db.execute(
        select(TelegramConfig).where(TelegramConfig.tenant_id == tenant_id, TelegramConfig.is_active == True)
    )
    return result.scalar_one_or_none()
