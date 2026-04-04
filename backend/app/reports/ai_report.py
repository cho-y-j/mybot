"""
ElectionPulse - AI-Powered Report Generator (B1)
Claude CLI를 활용한 전략적 일일 보고서.
실제 DB 데이터 기반, 객관성 원칙 준수.
"""
import asyncio
import json
import shutil
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import structlog
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Election, Candidate, NewsArticle, CommunityPost,
    YouTubeVideo, SearchTrend, Survey, SurveyCrosstab,
)

logger = structlog.get_logger()

# ── AI 보고서 프롬프트 ──

REPORT_SYSTEM_PROMPT = """당신은 선거 캠프의 수석 전략 분석관입니다.
아래 데이터를 기반으로 일일 전략 보고서를 작성합니다.

[절대 원칙]
1. 우리 후보에게 불리한 정보도 숨기지 않고 그대로 보고
2. "잘하고 있다", "긍정적이다" 같은 위안성 표현 금지
3. 수치와 데이터로만 판단 (주관적 평가 금지)
4. 경쟁자의 강점도 정확히 분석
5. 텔레그램에서 읽기 좋게 간결하게 작성
6. 기사 URL이 있으면 반드시 포함

[보고서 형식 — 정확히 이 5개 섹션만]
1. 📊 오늘 현황: 뉴스 건수, 전일 대비 변화, 핵심 기사 + URL
2. ⚔️ 경쟁자 대비 체크: 우리가 부족한 점 구체적으로
3. 💬 여론 동향: 커뮤니티/댓글 감성 요약, 유권자 관심사
4. 🚨 위기/기회: 부정 뉴스, 이슈 선점 기회
5. 🎯 AI 전략 제안: 오늘 해야 할 구체적 행동 3가지

각 섹션은 3-5줄 이내로 핵심만. 총 보고서 길이 1500자 이내.
반드시 한국어로 작성.
"""


async def generate_ai_report(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
) -> dict:
    """
    AI 기반 전략 보고서 생성.
    Returns: {"text": str, "sections": dict, "ai_generated": bool}
    """
    # 1. DB에서 모든 데이터 수집
    data_context = await _build_report_data(db, tenant_id, election_id)

    if not data_context.get("election"):
        return {"text": "선거 정보를 찾을 수 없습니다.", "sections": {}, "ai_generated": False}

    # 2. 데이터 팩트시트 생성
    factsheet = _format_factsheet(data_context)

    # 3. Claude CLI로 AI 분석
    ai_text = await _call_claude_for_report(factsheet)

    if ai_text:
        report_text = _format_final_report(data_context, ai_text)
        return {
            "text": report_text,
            "sections": data_context.get("sections_data", {}),
            "ai_generated": True,
        }

    # 4. AI 불가시 데이터 기반 자동 보고서
    fallback_text = _generate_fallback_report(data_context)
    return {
        "text": fallback_text,
        "sections": data_context.get("sections_data", {}),
        "ai_generated": False,
    }


async def _build_report_data(
    db: AsyncSession, tenant_id: str, election_id: str,
) -> dict:
    """DB에서 보고서용 데이터 수집."""
    today = date.today()
    yesterday = today - timedelta(days=1)
    week_ago = today - timedelta(days=7)
    now_kst = datetime.now(timezone(timedelta(hours=9)))

    # 선거 정보
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {}

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == tenant_id,
            Candidate.enabled == True,
        ).order_by(Candidate.priority)
    )).scalars().all()

    our = next((c for c in candidates if c.is_our_candidate), None)
    d_day = (election.election_date - today).days

    # ── 후보별 뉴스 통계 ──
    candidate_news = []
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
        week_cnt = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == c.id,
                func.date(NewsArticle.collected_at) >= week_ago,
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
        total_all = (await db.execute(
            select(func.count()).where(NewsArticle.candidate_id == c.id)
        )).scalar() or 0
        total_neg = (await db.execute(
            select(func.count()).where(
                NewsArticle.candidate_id == c.id,
                NewsArticle.sentiment == "negative",
            )
        )).scalar() or 0

        candidate_news.append({
            "name": c.name,
            "party": c.party or "무소속",
            "is_ours": c.is_our_candidate,
            "today": today_cnt,
            "yesterday": yesterday_cnt,
            "week": week_cnt,
            "today_pos": pos,
            "today_neg": neg,
            "total": total_all,
            "total_neg": total_neg,
        })

    # ── 최근 뉴스 (URL 포함) ──
    recent_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id == tenant_id,
            NewsArticle.election_id == election_id,
        )
        .order_by(NewsArticle.collected_at.desc())
        .limit(15)
    )).all()

    news_items = []
    for n, cname in recent_news:
        news_items.append({
            "title": n.title,
            "url": n.url,
            "source": n.source,
            "sentiment": n.sentiment or "neutral",
            "candidate": cname,
            "date": (n.published_at or n.collected_at).strftime("%m/%d") if (n.published_at or n.collected_at) else "",
        })

    # ── 부정 뉴스 ──
    negative_news = (await db.execute(
        select(NewsArticle, Candidate.name)
        .join(Candidate, NewsArticle.candidate_id == Candidate.id)
        .where(
            NewsArticle.tenant_id == tenant_id,
            NewsArticle.election_id == election_id,
            NewsArticle.sentiment == "negative",
        )
        .order_by(NewsArticle.collected_at.desc())
        .limit(10)
    )).all()

    neg_items = [{
        "title": n.title, "url": n.url, "candidate": cname,
        "date": (n.published_at or n.collected_at).strftime("%m/%d") if (n.published_at or n.collected_at) else "",
    } for n, cname in negative_news]

    # ── 커뮤니티 ──
    community_stats = []
    for c in candidates:
        cnt = (await db.execute(
            select(func.count()).where(CommunityPost.candidate_id == c.id)
        )).scalar() or 0
        pos_cnt = (await db.execute(
            select(func.count()).where(
                CommunityPost.candidate_id == c.id,
                CommunityPost.sentiment == "positive",
            )
        )).scalar() or 0
        neg_cnt = (await db.execute(
            select(func.count()).where(
                CommunityPost.candidate_id == c.id,
                CommunityPost.sentiment == "negative",
            )
        )).scalar() or 0
        community_stats.append({
            "name": c.name, "count": cnt,
            "positive": pos_cnt, "negative": neg_cnt,
        })

    # 최근 커뮤니티 글
    recent_community = (await db.execute(
        select(CommunityPost, Candidate.name)
        .join(Candidate, CommunityPost.candidate_id == Candidate.id)
        .where(CommunityPost.tenant_id == tenant_id)
        .order_by(CommunityPost.collected_at.desc())
        .limit(10)
    )).all()

    community_items = [{
        "title": p.title, "source": p.source, "candidate": cname,
        "sentiment": p.sentiment or "neutral",
        "issue": p.issue_category or "",
    } for p, cname in recent_community]

    # ── 유튜브 ──
    youtube_stats = []
    for c in candidates:
        vid_cnt = (await db.execute(
            select(func.count()).where(YouTubeVideo.candidate_id == c.id)
        )).scalar() or 0
        total_views = (await db.execute(
            select(func.coalesce(func.sum(YouTubeVideo.views), 0)).where(
                YouTubeVideo.candidate_id == c.id
            )
        )).scalar() or 0
        youtube_stats.append({
            "name": c.name, "count": vid_cnt, "views": int(total_views),
        })

    # ── 유튜브 댓글 감성 ──
    from app.elections.history_models import YouTubeComment
    yt_comment_stats = []
    try:
        for c in candidates:
            # 후보별 유튜브 댓글 — 해당 후보 비디오의 댓글
            vids = (await db.execute(
                select(YouTubeVideo.video_id).where(YouTubeVideo.candidate_id == c.id)
            )).scalars().all()
            if vids:
                total_comments = (await db.execute(
                    select(func.count()).where(YouTubeComment.video_id.in_(vids))
                )).scalar() or 0
                pos_comments = (await db.execute(
                    select(func.count()).where(
                        YouTubeComment.video_id.in_(vids),
                        YouTubeComment.sentiment == "positive",
                    )
                )).scalar() or 0
                neg_comments = (await db.execute(
                    select(func.count()).where(
                        YouTubeComment.video_id.in_(vids),
                        YouTubeComment.sentiment == "negative",
                    )
                )).scalar() or 0
                yt_comment_stats.append({
                    "name": c.name, "total": total_comments,
                    "positive": pos_comments, "negative": neg_comments,
                })
    except Exception as e:
        logger.warning("youtube_comment_stats_error", error=str(e))

    # ── 검색 트렌드 ──
    trends = (await db.execute(
        select(SearchTrend).where(
            SearchTrend.tenant_id == tenant_id,
            SearchTrend.election_id == election_id,
        ).order_by(SearchTrend.checked_at.desc()).limit(20)
    )).scalars().all()

    trend_items = [{
        "keyword": t.keyword,
        "volume": t.relative_volume or t.search_volume or 0,
        "platform": t.platform,
    } for t in trends]

    # ── 최신 여론조사 ──
    latest_survey = (await db.execute(
        select(Survey).where(Survey.tenant_id == tenant_id)
        .order_by(Survey.survey_date.desc()).limit(3)
    )).scalars().all()

    survey_items = []
    for s in latest_survey:
        survey_items.append({
            "org": s.survey_org,
            "date": s.survey_date.isoformat() if s.survey_date else "",
            "results": s.results if isinstance(s.results, dict) else {},
            "sample_size": s.sample_size,
        })

    sections_data = {
        "candidate_news": candidate_news,
        "negative_news_count": len(neg_items),
        "community_total": sum(s["count"] for s in community_stats),
        "youtube_total": sum(s["count"] for s in youtube_stats),
    }

    return {
        "election": {
            "name": election.name,
            "date": election.election_date.isoformat(),
            "d_day": d_day,
            "region": f"{election.region_sido or ''} {election.region_sigungu or ''}".strip(),
            "type": election.election_type,
        },
        "our_candidate": our.name if our else None,
        "candidates": [c.name for c in candidates],
        "candidate_news": candidate_news,
        "recent_news": news_items,
        "negative_news": neg_items,
        "community_stats": community_stats,
        "community_items": community_items,
        "youtube_stats": youtube_stats,
        "yt_comment_stats": yt_comment_stats,
        "trends": trend_items,
        "surveys": survey_items,
        "now_kst": now_kst.strftime("%Y-%m-%d %H:%M"),
        "sections_data": sections_data,
    }


def _format_factsheet(data: dict) -> str:
    """데이터를 AI가 분석할 수 있는 팩트시트로 변환."""
    lines = []
    el = data["election"]
    lines.append(f"=== 선거: {el['name']} (D-{el['d_day']}) ===")
    lines.append(f"지역: {el['region']}, 선거일: {el['date']}")
    lines.append(f"우리 후보: {data['our_candidate'] or '미지정'}")
    lines.append(f"전체 후보: {', '.join(data['candidates'])}")
    lines.append("")

    # 뉴스 통계
    lines.append("=== 후보별 뉴스 현황 ===")
    for cn in data["candidate_news"]:
        marker = " (우리)" if cn["is_ours"] else ""
        change = cn["today"] - cn["yesterday"]
        change_s = f"+{change}" if change > 0 else str(change)
        lines.append(
            f"{cn['name']}{marker}: 오늘 {cn['today']}건({change_s}), "
            f"주간 {cn['week']}건, 전체 {cn['total']}건 "
            f"| 오늘 긍정 {cn['today_pos']} 부정 {cn['today_neg']}"
        )
    lines.append("")

    # 최근 뉴스 (URL 포함)
    lines.append("=== 최근 주요 뉴스 ===")
    for n in data["recent_news"][:10]:
        sent = {"positive": "+", "negative": "-", "neutral": "o"}.get(n["sentiment"], "o")
        lines.append(f"[{sent}][{n['candidate']}] {n['title']}")
        if n["url"]:
            lines.append(f"  URL: {n['url']}")
    lines.append("")

    # 부정 뉴스
    if data["negative_news"]:
        lines.append("=== 부정 뉴스 경보 ===")
        for n in data["negative_news"][:5]:
            lines.append(f"[{n['candidate']}] {n['title']}")
            if n["url"]:
                lines.append(f"  URL: {n['url']}")
        lines.append("")

    # 커뮤니티
    lines.append("=== 커뮤니티 현황 ===")
    for cs in data["community_stats"]:
        lines.append(f"{cs['name']}: {cs['count']}건 (긍정 {cs['positive']}, 부정 {cs['negative']})")
    if data["community_items"]:
        lines.append("최근 글:")
        for ci in data["community_items"][:5]:
            lines.append(f"  [{ci['candidate']}][{ci['source']}] {ci['title']} (이슈: {ci['issue'] or '일반'})")
    lines.append("")

    # 유튜브
    lines.append("=== 유튜브 현황 ===")
    for ys in data["youtube_stats"]:
        lines.append(f"{ys['name']}: {ys['count']}개 영상, {ys['views']:,}회 조회")
    if data["yt_comment_stats"]:
        lines.append("유튜브 댓글 감성:")
        for yc in data["yt_comment_stats"]:
            lines.append(f"  {yc['name']}: {yc['total']}건 (긍정 {yc['positive']}, 부정 {yc['negative']})")
    lines.append("")

    # 검색 트렌드
    if data["trends"]:
        lines.append("=== 검색 트렌드 ===")
        for t in data["trends"][:10]:
            lines.append(f"{t['keyword']}: 검색량 {t['volume']} ({t['platform']})")
        lines.append("")

    # 여론조사
    if data["surveys"]:
        lines.append("=== 최신 여론조사 ===")
        for s in data["surveys"]:
            results_str = ", ".join(f"{k}: {v}%" for k, v in s["results"].items()) if s["results"] else "결과 없음"
            lines.append(f"{s['org']} ({s['date']}): {results_str} (n={s['sample_size'] or '?'})")
        lines.append("")

    return "\n".join(lines)


def _format_final_report(data: dict, ai_text: str) -> str:
    """AI 분석 텍스트를 최종 보고서 형태로 포맷."""
    el = data["election"]
    header = (
        f"📋 [D-{el['d_day']}] AI 전략 보고서\n"
        f"{data['now_kst']}\n"
        f"{'=' * 28}\n"
    )
    footer = (
        f"\n{'=' * 28}\n"
        f"ElectionPulse AI | 실데이터 기반 분석"
    )
    return header + ai_text + footer


def _generate_fallback_report(data: dict) -> str:
    """AI 불가시 데이터 기반 자동 보고서."""
    el = data["election"]
    now = data["now_kst"]
    lines = []
    lines.append(f"📋 [D-{el['d_day']}] 일일 보고서 (데이터 기반)")
    lines.append(f"{now}")
    lines.append("=" * 28)

    # 1. 오늘 현황
    lines.append("")
    lines.append("📊 <b>[1. 오늘 현황]</b>")
    for cn in data["candidate_news"]:
        marker = " ⭐" if cn["is_ours"] else ""
        change = cn["today"] - cn["yesterday"]
        arrow = "↑" if change > 0 else ("↓" if change < 0 else "→")
        lines.append(
            f"  {cn['name']}{marker}: {cn['today']}건({arrow}{abs(change)}) "
            f"긍정{cn['today_pos']}/부정{cn['today_neg']}"
        )

    # 2. 경쟁자 대비
    lines.append("")
    lines.append("⚔️ <b>[2. 경쟁자 대비]</b>")
    our_data = next((cn for cn in data["candidate_news"] if cn["is_ours"]), None)
    if our_data:
        max_news = max((cn["today"] for cn in data["candidate_news"]), default=0)
        if max_news > 0:
            ratio = our_data["today"] / max_news * 100
            leader = max(data["candidate_news"], key=lambda x: x["today"])
            if ratio < 100:
                lines.append(f"  뉴스 노출: {our_data['name']} {our_data['today']}건 vs {leader['name']} {leader['today']}건 ({ratio:.0f}%)")
            else:
                lines.append(f"  뉴스 노출: {our_data['name']} 선두 ({our_data['today']}건)")

    # 3. 여론 동향
    lines.append("")
    lines.append("💬 <b>[3. 여론 동향]</b>")
    for cs in data["community_stats"]:
        if cs["count"] > 0:
            lines.append(f"  {cs['name']}: 커뮤니티 {cs['count']}건 (긍정 {cs['positive']}, 부정 {cs['negative']})")

    # 4. 위기/기회
    lines.append("")
    lines.append("🚨 <b>[4. 위기/기회]</b>")
    if data["negative_news"]:
        for n in data["negative_news"][:3]:
            lines.append(f"  🔴 [{n['candidate']}] {n['title'][:40]}")
            if n["url"]:
                lines.append(f"     {n['url']}")
    else:
        lines.append("  특이사항 없음")

    # 5. 할 일
    lines.append("")
    lines.append("🎯 <b>[5. 전략 제안]</b>")
    lines.append("  (AI 분석 불가 — Claude CLI 설치 필요)")
    if our_data and max_news > 0 and our_data["today"] / max_news < 0.5:
        lines.append(f"  → 뉴스 노출 강화 필요 (현재 선두 대비 {our_data['today'] / max_news * 100:.0f}%)")

    lines.append("")
    lines.append("=" * 28)
    lines.append("ElectionPulse | 상세분석은 대시보드에서")

    return "\n".join(lines)


async def _call_claude_for_report(factsheet: str) -> Optional[str]:
    """Claude CLI로 AI 보고서 생성."""
    claude_path = shutil.which("claude")
    if not claude_path:
        logger.info("claude_cli_not_found")
        return None

    prompt = f"{REPORT_SYSTEM_PROMPT}\n\n[수집 데이터 팩트시트]\n{factsheet}"

    try:
        proc = await asyncio.create_subprocess_exec(
            claude_path, "-p", prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=90)

        if proc.returncode == 0 and stdout:
            result = stdout.decode("utf-8").strip()
            if len(result) > 50:
                logger.info("ai_report_generated", length=len(result))
                return result
        logger.warning("claude_cli_empty_result")
        return None
    except asyncio.TimeoutError:
        logger.warning("claude_cli_timeout_report")
        return None
    except Exception as e:
        logger.error("claude_cli_report_error", error=str(e))
        return None
