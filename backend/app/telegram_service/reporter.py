"""
ElectionPulse - Telegram Report Service
스케줄 실행 결과를 텔레그램으로 자동 보고
"""
from datetime import datetime, timezone, date, timedelta
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Election, Candidate, NewsArticle, CommunityPost,
    YouTubeVideo, SearchTrend, TelegramConfig,
)
from app.analysis.sentiment import SentimentAnalyzer, TrendDetector
from app.telegram_service.bot import TelegramBot
import structlog

logger = structlog.get_logger()


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
    now = datetime.now(timezone(timedelta(hours=9)))

    text = (
        f"📊 <b>[{label} 수집 완료]</b>\n"
        f"시간: {now.strftime('%H:%M')}\n"
        f"수집: {items_collected}건\n"
    )

    await _send_to_all_recipients(db, tenant_id, text, "news")


async def send_briefing_report(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    briefing_type: str = "daily",
):
    """
    브리핑 보고서 생성 + 텔레그램 발송.
    briefing_type: morning | afternoon | daily
    """
    config = await _get_telegram_config(db, tenant_id)
    if not config:
        logger.warning("no_telegram_config", tenant_id=tenant_id)
        return

    # 데이터 수집
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == tenant_id,
            Candidate.enabled == True,
        ).order_by(Candidate.priority)
    )).scalars().all()

    our = next((c for c in candidates if c.is_our_candidate), None)
    today = date.today()
    d_day = (election.election_date - today).days
    now = datetime.now(timezone(timedelta(hours=9)))

    # 제목
    titles = {
        "morning": f"☀️ [D-{d_day}] 오전 브리핑",
        "afternoon": f"🌤 [D-{d_day}] 오후 브리핑",
        "daily": f"🌙 [D-{d_day}] 일일 보고서",
    }
    title = titles.get(briefing_type, f"📋 [D-{d_day}] 브리핑")

    lines = [
        f"<b>{title}</b>",
        f"{today.isoformat()} {now.strftime('%H:%M')}",
        f"{'=' * 25}",
        "",
    ]

    # ── 1. 후보별 뉴스 현황 ──
    lines.append("<b>[1. 뉴스 현황]</b>")
    for cand in candidates:
        news_count = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
            )
        )).scalar() or 0

        pos_count = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "positive",
            )
        )).scalar() or 0

        neg_count = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == cand.id,
                func.date(NewsArticle.collected_at) == today,
                NewsArticle.sentiment == "negative",
            )
        )).scalar() or 0

        marker = " ⭐" if cand.is_our_candidate else ""
        lines.append(
            f"  {cand.name}{marker}: {news_count}건 "
            f"(긍정 {pos_count} / 부정 {neg_count})"
        )

    lines.append("")

    # ── 2. 주요 뉴스 ──
    lines.append("<b>[2. 주요 뉴스]</b>")
    recent_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id == tenant_id,
            func.date(NewsArticle.collected_at) == today,
        )
        .order_by(NewsArticle.collected_at.desc())
        .limit(5)
    )).all()

    for news, cand_name in recent_news:
        emoji = {"positive": "🟢", "negative": "🔴", "neutral": "⚪"}.get(news.sentiment, "⚪")
        lines.append(f"  {emoji} [{cand_name}] {news.title[:50]}")

    lines.append("")

    # ── 3. 불편한 진실 (객관성 원칙) ──
    if our:
        lines.append("<b>[3. 불편한 진실]</b>")
        our_news = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == our.id,
                func.date(NewsArticle.collected_at) == today,
            )
        )).scalar() or 0

        total_news = (await db.execute(
            select(func.count()).where(
                NewsArticle.tenant_id == tenant_id,
                NewsArticle.election_id == election_id,
                func.date(NewsArticle.collected_at) == today,
            )
        )).scalar() or 0

        if total_news > 0:
            ratio = our_news / total_news * 100
            if ratio < 30:
                lines.append(
                    f"  ⚠️ {our.name} 뉴스 비중 {ratio:.0f}% — 노출 심각 부족"
                )
            elif ratio < 50:
                lines.append(
                    f"  ⚠️ {our.name} 뉴스 비중 {ratio:.0f}% — 경쟁자 대비 부족"
                )
            else:
                lines.append(f"  ✅ {our.name} 뉴스 비중 {ratio:.0f}% — 양호")

    # ── 4. 여론조사 현황 ──
    from sqlalchemy import text as sql_text
    polls = (await db.execute(
        sql_text("SELECT survey_org, survey_date, results FROM surveys ORDER BY survey_date DESC LIMIT 3")
    )).fetchall()

    if polls:
        lines.append("")
        lines.append("<b>[4. 최신 여론조사]</b>")
        for org, sdate, results in polls:
            r = results if isinstance(results, dict) else {}
            top3 = sorted(r.items(), key=lambda x: -x[1])[:3]
            top_str = " / ".join(f"{p} {v}%" for p, v in top3)
            lines.append(f"  {sdate} {org[:12]}: {top_str}")

    lines.append("")
    lines.append(f"{'=' * 25}")
    lines.append("ElectionPulse | 객관적 데이터 기반 분석")

    report_text = "\n".join(lines)

    # 모든 수신자에게 발송
    sent = await _send_to_all_recipients(db, tenant_id, report_text, "briefing")
    logger.info("briefing_sent", tenant_id=tenant_id, type=briefing_type, recipients=sent)

    return report_text


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
