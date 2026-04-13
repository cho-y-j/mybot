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

import app.auth.models  # ORM relationship resolution (Tenant 등)
from app.elections.models import (
    Election, Candidate, NewsArticle, CommunityPost,
    YouTubeVideo, SearchTrend, Survey, SurveyCrosstab,
)

logger = structlog.get_logger()

# ── AI 보고서 프롬프트 ──

REPORT_PROMPT_DAILY = """당신은 선거 캠프의 수석 전략 분석관입니다.
아래 데이터를 기반으로 일일 종합 전략 보고서를 작성합니다.

[절대 원칙]
1. 우리 후보에게 불리한 정보도 숨기지 않고 그대로 보고
2. "잘하고 있다", "긍정적이다" 같은 위안성 표현 금지
3. 수치와 데이터로만 판단 (주관적 평가 금지)
4. 경쟁자의 강점도 정확히 분석
5. 기사 URL이 있으면 반드시 포함
6. 검색 트렌드는 네이버 DataLab 상대 지수(동명이인 포함). 절대값이 낮으면 솔직히 낮다고 보고. 단, 수치 옆에 "(동명이인 포함)" 표기

[보고서 형식 — 3파트 16섹션]

═══ PART 1: 현황 ═══
1. 핵심 요약 (30초 브리핑) — D-Day, 현재 순위, 오늘 핵심 변화 1줄
2. 후보 비교 분석 — 후보별 뉴스 건수, 감성, 미디어 점유율 비교
3. 검색 노출 현황 — 검색 트렌드 순위, 검색량 변화
4. 뉴스 모니터링 — 주요 기사 요약 + URL (긍정/부정 분류)
5. SNS/커뮤니티 여론 — 카페/블로그/유튜브 댓글 감성 요약
6. 경쟁자 동향 — 경쟁자별 특이사항, 공약, 활동

═══ PART 2: 분석 ═══
7. SWOT 전략 분석 — 우리 후보 강점/약점/기회/위협
8. 여론조사 현황 — 최신 지지율, 추세 (상승/하락/보합)
9. 과거 선거 참고 — 해당 지역 역대 선거 패턴 시사점
10. 타겟 유권자 공략 — 세그먼트별 공략 전략 (연령대/지역 등)
11. 지역별 전략 — 강세/약세/접전 지역별 대응

═══ PART 3: 전략 ═══
12. 위험 항목 & 대응 — 부정 뉴스, 감성 악화, 대응 방안
13. AI 전략 제언 — 오늘 해야 할 구체적 행동 5가지
14. 콘텐츠 전략 — 블로그/유튜브/SNS 주제 추천
15. 불편한 진실 — 우리에게 불리한 데이터 솔직히 (필수)
16. 스케줄 실행 현황 — 오늘 수집/분석 현황 요약

각 섹션은 3-8줄. 총 보고서 4000자 이내. 반드시 한국어.
"""

REPORT_PROMPT_MORNING = """당신은 선거 캠프의 전략 분석관입니다.
오전 브리핑을 작성합니다. 간결하게 5섹션만.

[보고서 형식]
1. 핵심 요약 — 어제 변화, 오늘 예상
2. 뉴스 체크 — 어제 주요 기사 3건 + URL
3. 경쟁자 — 경쟁자 어제 활동
4. 위기/기회 — 부정 뉴스 있으면 대응
5. 오늘 할 일 — 구체적 3가지

각 섹션 3줄 이내. 총 1000자. 한국어.
"""

REPORT_PROMPT_AFTERNOON = """당신은 선거 캠프의 전략 분석관입니다.
오후 중간점검을 작성합니다.

[보고서 형식]
1. 오전 변화 — 오전에 나온 뉴스/이슈
2. 감성 변화 — 긍정/부정 변동
3. 경쟁자 — 경쟁자 오전 활동
4. 대응 필요 — 즉시 대응할 사항
5. 오후 전략 — 오후에 해야 할 것

각 섹션 3줄 이내. 총 800자. 한국어.
"""

REPORT_PROMPT_WEEKLY = """당신은 선거 캠프의 수석 전략 분석관입니다.
이번 한 주간의 선거 데이터를 종합 분석하여 주간 전략 보고서를 작성합니다.

[절대 원칙]
1. 우리 후보에게 불리한 정보도 숨기지 않고 그대로 보고
2. "잘하고 있다", "긍정적이다" 같은 위안성 표현 금지
3. 수치와 데이터로만 판단 (주관적 평가 금지)
4. 이번 주와 지난 주 비교가 핵심 (변화 추이)
5. 기사 URL이 있으면 반드시 포함

[보고서 형식 — 4파트 20섹션]

═══ PART 1: 주간 현황 총괄 ═══
1. 주간 핵심 요약 (1분 브리핑) — D-Day, 이번 주 핵심 변화, 순위 변동
2. 후보별 주간 비교표 — 후보별 주간 뉴스, 감성비율, 미디어 점유율 변화
3. 주간 검색 트렌드 — 검색량 추이 (상승/하락), 키워드별 변화
4. 주간 뉴스 TOP 10 — 이번 주 가장 영향력 있었던 기사 10건 + URL

═══ PART 2: 주간 미디어 분석 ═══
5. 뉴스 감성 추이 — 일별 긍정/부정 변화 그래프 해석
6. 커뮤니티 여론 동향 — 블로그/카페 주요 담론, 감성 변화
7. 유튜브 동향 — 영상 조회수, 댓글 감성, 위기 영상
8. 경쟁자별 주간 활동 — 경쟁자 각각의 주요 활동 요약

═══ PART 3: 전략 분석 ═══
9. SWOT 주간 변화 — 강점/약점/기회/위협 변동 사항
10. 여론조사 추세 — 최신 지지율, 이번 주 변동 (+/- 포인트)
11. 유권자 반응 분석 — 세대별/지역별 반응 차이
12. 위기 관리 리뷰 — 이번 주 위기 상황과 대응 평가
13. 경쟁 우위 분석 — 경쟁자 대비 어디서 이기고 어디서 지는지

═══ PART 4: 다음 주 전략 ═══
14. 다음 주 핵심 과제 5가지 — 구체적이고 실행 가능한 행동
15. 콘텐츠 전략 — 다음 주 블로그/유튜브/SNS 주제 추천 5개
16. 공약 커뮤니케이션 — 어떤 공약을 어떤 채널로 전달할지
17. 위기 대비 시나리오 — 예상되는 공격과 대응 방안
18. 타겟 공략 전략 — 다음 주 집중할 유권자 세그먼트
19. 불편한 진실 — 이번 주 우리에게 가장 불리했던 데이터 (필수)
20. 전략 조정 권고 — 지난주 대비 전략을 바꿔야 할 부분

각 섹션은 5-10줄. 총 보고서 6000자 이상. 반드시 한국어.
데이터에 근거하여 구체적 수치를 포함하세요. 추상적 표현 금지.
"""

# 기본 호환용 (기존 코드에서 참조)
REPORT_SYSTEM_PROMPT = REPORT_PROMPT_DAILY


async def generate_ai_report(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    report_type: str = "daily",
) -> dict:
    """
    AI 기반 전략 보고서 생성.
    report_type: "daily" (16섹션), "morning" (5섹션), "afternoon" (5섹션)
    Returns: {"text": str, "sections": dict, "ai_generated": bool}
    """
    # 1. DB에서 모든 데이터 수집
    data_context = await _build_report_data(db, tenant_id, election_id)

    if not data_context.get("election"):
        return {"text": "선거 정보를 찾을 수 없습니다.", "sections": {}, "ai_generated": False}

    # 2. 데이터 팩트시트 생성
    factsheet = _format_factsheet(data_context)

    # 2.5. 이전 보고서 요약 주입 (연속성)
    try:
        from app.elections.models import Report
        prev_reports = (await db.execute(
            select(Report).where(
                Report.tenant_id == tenant_id,
                Report.election_id == election_id,
                Report.report_type.in_(["daily", "weekly"]),
            ).order_by(Report.report_date.desc()).limit(2)
        )).scalars().all()

        if prev_reports:
            factsheet += "\n\n=== 이전 보고서 요약 ===\n"
            for pr in prev_reports:
                date_str = pr.report_date.isoformat() if pr.report_date else ""
                content = (pr.content_text or "")[:300].replace("\n", " ")
                factsheet += f"[{date_str}] {content}...\n"
            factsheet += "위 이전 보고서의 전략 추천이 오늘 데이터에 반영되었는지 평가하세요.\n"
    except Exception:
        pass

    # 3. Claude CLI로 AI 분석 (보고서 유형별 프롬프트)
    prompt_map = {
        "daily": REPORT_PROMPT_DAILY,
        "morning": REPORT_PROMPT_MORNING,
        "afternoon": REPORT_PROMPT_AFTERNOON,
        "weekly": REPORT_PROMPT_WEEKLY,
    }
    system_prompt = prompt_map.get(report_type, REPORT_PROMPT_DAILY)
    ai_text = await _call_claude_for_report(factsheet, system_prompt)

    # PDF 차트용 후보 데이터 구성
    candidates_data = []
    for cn in data_context.get("candidate_news", []):
        cm = next((c for c in data_context.get("community_stats", []) if c.get("name") == cn["name"]), {})
        yt = next((y for y in data_context.get("youtube_stats", []) if y.get("name") == cn["name"]), {})
        candidates_data.append({
            "name": cn["name"],
            "is_ours": cn.get("is_ours", False),
            "news": cn.get("week", 0),
            "pos": cn.get("today_pos", 0),
            "neg": cn.get("today_neg", 0),
            "community": cm.get("count", 0) or cm.get("total", 0),
            "yt_views": yt.get("views", 0) or yt.get("total_views", 0),
            "yt_count": yt.get("count", 0) or yt.get("total_videos", 0),
            "search_vol": 0,
        })

    pdf_meta = {
        "election_name": data_context.get("election", {}).get("name", ""),
        "d_day": data_context.get("election", {}).get("d_day", 0),
        "our_candidate": data_context.get("our_candidate", ""),
        "candidates_data": candidates_data,
    }

    if ai_text:
        report_text = _format_final_report(data_context, ai_text)
        return {
            "text": report_text,
            "sections": data_context.get("sections_data", {}),
            "ai_generated": True,
            "pdf_meta": pdf_meta,
        }

    # 4. AI 불가시 데이터 기반 자동 보고서
    fallback_text = _generate_fallback_report(data_context)
    return {
        "text": fallback_text,
        "sections": data_context.get("sections_data", {}),
        "ai_generated": False,
        "pdf_meta": pdf_meta,
    }


async def _build_report_data(
    db: AsyncSession, tenant_id: str, election_id: str,
) -> dict:
    """DB에서 보고서용 데이터 수집."""
    today = date.today()
    yesterday = today - timedelta(days=1)
    week_ago = today - timedelta(days=7)
    now_kst = datetime.now(timezone(timedelta(hours=9)))

    # 선거 정보 (공유 데이터 지원)
    from app.common.election_access import get_election_tenant_ids, get_our_candidate_id

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {}

    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id = await get_our_candidate_id(db, tenant_id, election_id)

    all_candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id.in_(all_tids),
            Candidate.enabled == True,
        ).order_by(Candidate.priority)
    )).scalars().all()

    # 중복 제거 + 우리 후보 동적 설정
    seen = set()
    candidates = []
    for c in all_candidates:
        if c.name not in seen:
            seen.add(c.name)
            if our_cand_id:
                c.is_our_candidate = (str(c.id) == our_cand_id)
            candidates.append(c)

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
        .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
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
        .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
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

    # ── 교차분석 요약 ──
    crosstab_summary = []
    try:
        survey_ids = [s.id for s in latest_survey]
        if survey_ids:
            cts = (await db.execute(
                select(SurveyCrosstab).where(SurveyCrosstab.survey_id.in_(survey_ids))
            )).scalars().all()
            # 차원별 그룹핑 (상위 항목만)
            from collections import defaultdict
            dims = defaultdict(lambda: defaultdict(dict))
            for ct in cts:
                dims[ct.dimension][ct.segment][ct.candidate] = ct.value
            for dim, segs in dims.items():
                for seg, cands in list(segs.items())[:5]:
                    crosstab_summary.append(f"[{dim}] {seg}: " + ", ".join(f"{k} {v}%" for k, v in cands.items()))
    except Exception as e:
        logger.warning("ai_report_crosstab_error", error=str(e)[:200])

    # ── 과거 선거 요약 ──
    history_summary = []
    try:
        from app.elections.history_models import ElectionResult
        hist_results = (await db.execute(
            select(ElectionResult).where(
                ElectionResult.tenant_id == tenant_id,
                ElectionResult.region_sido == election.region_sido,
                ElectionResult.election_type == election.election_type,
                ElectionResult.is_winner == True,
            ).order_by(ElectionResult.election_year.desc()).limit(6)
        )).scalars().all()
        for h in hist_results:
            history_summary.append(f"{h.election_year}년: {h.candidate_name} ({h.party}) {h.vote_rate}%")
    except Exception as e:
        logger.warning("ai_report_history_error", error=str(e)[:200])

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
        "crosstab_summary": crosstab_summary,
        "history_summary": history_summary,
        "now_kst": now_kst.strftime("%Y-%m-%d %H:%M"),
        "sections_data": sections_data,
    }


def _format_factsheet(data: dict) -> str:
    """데이터를 AI가 분석할 수 있는 팩트시트로 변환 — 템플릿 렌더링."""
    from app.reports.template_engine import render
    return render("ai_factsheet.txt", **data)


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
    """AI 불가시 데이터 기반 자동 보고서 — 템플릿 렌더링."""
    from app.reports.template_engine import render
    our_data = next((cn for cn in data["candidate_news"] if cn["is_ours"]), None)
    max_news = max((cn["today"] for cn in data["candidate_news"]), default=0)
    leader = max(data["candidate_news"], key=lambda x: x["today"]) if data["candidate_news"] else None
    return render("fallback_report.txt",
        election=data["election"],
        now_kst=data["now_kst"],
        candidate_news=data["candidate_news"],
        community_stats=data["community_stats"],
        negative_news=data["negative_news"],
        our_data=our_data,
        max_news=max_news,
        leader=leader,
    )


async def _call_claude_for_report(factsheet: str, system_prompt: str = None) -> Optional[str]:
    """Claude CLI로 AI 보고서 생성 — ai_service로 위임."""
    from app.services.ai_service import call_claude_text
    prompt = f"{system_prompt or REPORT_PROMPT_DAILY}\n\n[수집 데이터 팩트시트]\n{factsheet}"
    # Sonnet으로 생성 (안정적), Opus 검증은 별도 단계에서
    return await call_claude_text(prompt, timeout=180, context="ai_report_generation", model_tier="standard")
