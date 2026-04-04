"""
ElectionPulse - Competitor Gap Analysis (B2)
우리 후보가 경쟁자 대비 부족한 점을 객관적으로 분석.
실제 DB 데이터 기반, 모든 수치는 실데이터.
"""
import asyncio
import json
import shutil
from datetime import date, timedelta
from typing import Optional

import structlog
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Candidate, NewsArticle, CommunityPost,
    YouTubeVideo, SearchTrend,
)
from app.analysis.sentiment import TrendDetector

logger = structlog.get_logger()


async def analyze_competitor_gaps(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    days: int = 7,
) -> dict:
    """
    경쟁자 대비 갭 분석.
    Returns: {
        "gaps": [...],           # 부족한 영역
        "strengths": [...],      # 우위 영역
        "parity": [...],         # 비슷한 영역
        "ai_summary": str,       # AI 요약 (있으면)
        "our_candidate": str,
        "analysis_period": str,
    }
    """
    since = date.today() - timedelta(days=days)

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == tenant_id,
            Candidate.enabled == True,
        ).order_by(Candidate.priority)
    )).scalars().all()

    our = next((c for c in candidates if c.is_our_candidate), None)
    if not our:
        return {"gaps": [], "strengths": [], "parity": [], "ai_summary": "우리 후보 미지정",
                "our_candidate": None, "analysis_period": f"최근 {days}일"}

    competitors = [c for c in candidates if not c.is_our_candidate]
    if not competitors:
        return {"gaps": [], "strengths": [], "parity": [], "ai_summary": "경쟁 후보 없음",
                "our_candidate": our.name, "analysis_period": f"최근 {days}일"}

    gaps = []
    strengths = []
    parity = []

    # ── 1. 뉴스 노출량 비교 ──
    our_news = await _count_news(db, our.id, since)
    for comp in competitors:
        comp_news = await _count_news(db, comp.id, since)
        result = _compare_metric(
            area="뉴스 노출",
            our_value=our_news,
            comp_value=comp_news,
            comp_name=comp.name,
            unit="건",
            higher_is_better=True,
        )
        _categorize(result, gaps, strengths, parity)

    # ── 2. 긍정/부정 비율 비교 ──
    our_sent = await _get_sentiment_ratio(db, our.id, since)
    for comp in competitors:
        comp_sent = await _get_sentiment_ratio(db, comp.id, since)
        result = _compare_metric(
            area="긍정 뉴스 비율",
            our_value=round(our_sent["pos_rate"], 1),
            comp_value=round(comp_sent["pos_rate"], 1),
            comp_name=comp.name,
            unit="%",
            higher_is_better=True,
        )
        _categorize(result, gaps, strengths, parity)

        # 부정 비율 (낮을수록 좋음)
        result_neg = _compare_metric(
            area="부정 뉴스 비율",
            our_value=round(our_sent["neg_rate"], 1),
            comp_value=round(comp_sent["neg_rate"], 1),
            comp_name=comp.name,
            unit="%",
            higher_is_better=False,  # 낮을수록 좋음
        )
        _categorize(result_neg, gaps, strengths, parity)

    # ── 3. 커뮤니티 언급 비교 ──
    our_community = await _count_community(db, our.id)
    for comp in competitors:
        comp_community = await _count_community(db, comp.id)
        result = _compare_metric(
            area="커뮤니티 언급",
            our_value=our_community,
            comp_value=comp_community,
            comp_name=comp.name,
            unit="건",
            higher_is_better=True,
        )
        _categorize(result, gaps, strengths, parity)

    # ── 4. 유튜브 영상/조회수 비교 ──
    our_yt = await _get_youtube_stats(db, our.id)
    for comp in competitors:
        comp_yt = await _get_youtube_stats(db, comp.id)
        # 영상 수
        result_cnt = _compare_metric(
            area="유튜브 영상 수",
            our_value=our_yt["count"],
            comp_value=comp_yt["count"],
            comp_name=comp.name,
            unit="개",
            higher_is_better=True,
        )
        _categorize(result_cnt, gaps, strengths, parity)

        # 총 조회수
        result_views = _compare_metric(
            area="유튜브 총 조회수",
            our_value=our_yt["views"],
            comp_value=comp_yt["views"],
            comp_name=comp.name,
            unit="회",
            higher_is_better=True,
        )
        _categorize(result_views, gaps, strengths, parity)

    # ── 5. 검색 트렌드 비교 ──
    our_search = await _get_search_volume(db, tenant_id, election_id, our.name)
    for comp in competitors:
        comp_search = await _get_search_volume(db, tenant_id, election_id, comp.name)
        result = _compare_metric(
            area="검색량",
            our_value=our_search,
            comp_value=comp_search,
            comp_name=comp.name,
            unit="",
            higher_is_better=True,
        )
        _categorize(result, gaps, strengths, parity)

    # ── 6. 이슈 커버리지 갭 분석 ──
    issue_gaps = await _analyze_issue_gaps(db, our.id, competitors)
    gaps.extend(issue_gaps)

    # severity 기준으로 정렬
    severity_order = {"critical": 0, "warning": 1, "info": 2}
    gaps.sort(key=lambda x: severity_order.get(x.get("severity", "info"), 9))

    # ── AI 요약 생성 ──
    ai_summary = await _generate_ai_summary(gaps, strengths, our.name)

    return {
        "gaps": gaps,
        "strengths": strengths,
        "parity": parity,
        "ai_summary": ai_summary,
        "our_candidate": our.name,
        "analysis_period": f"최근 {days}일",
    }


# ── DB 쿼리 헬퍼 ──

async def _count_news(db: AsyncSession, candidate_id, since: date) -> int:
    return (await db.execute(
        select(func.count()).where(
            NewsArticle.candidate_id == candidate_id,
            func.date(NewsArticle.collected_at) >= since,
        )
    )).scalar() or 0


async def _get_sentiment_ratio(db: AsyncSession, candidate_id, since: date) -> dict:
    total = (await db.execute(
        select(func.count()).where(
            NewsArticle.candidate_id == candidate_id,
            func.date(NewsArticle.collected_at) >= since,
        )
    )).scalar() or 0
    pos = (await db.execute(
        select(func.count()).where(
            NewsArticle.candidate_id == candidate_id,
            func.date(NewsArticle.collected_at) >= since,
            NewsArticle.sentiment == "positive",
        )
    )).scalar() or 0
    neg = (await db.execute(
        select(func.count()).where(
            NewsArticle.candidate_id == candidate_id,
            func.date(NewsArticle.collected_at) >= since,
            NewsArticle.sentiment == "negative",
        )
    )).scalar() or 0

    return {
        "total": total,
        "positive": pos,
        "negative": neg,
        "pos_rate": (pos / total * 100) if total > 0 else 0,
        "neg_rate": (neg / total * 100) if total > 0 else 0,
    }


async def _count_community(db: AsyncSession, candidate_id) -> int:
    return (await db.execute(
        select(func.count()).where(CommunityPost.candidate_id == candidate_id)
    )).scalar() or 0


async def _get_youtube_stats(db: AsyncSession, candidate_id) -> dict:
    count = (await db.execute(
        select(func.count()).where(YouTubeVideo.candidate_id == candidate_id)
    )).scalar() or 0
    views = (await db.execute(
        select(func.coalesce(func.sum(YouTubeVideo.views), 0))
        .where(YouTubeVideo.candidate_id == candidate_id)
    )).scalar() or 0
    return {"count": count, "views": int(views)}


async def _get_search_volume(
    db: AsyncSession, tenant_id: str, election_id: str, candidate_name: str,
) -> float:
    """후보 이름 관련 검색 트렌드의 최근 검색량."""
    result = (await db.execute(
        select(SearchTrend.relative_volume)
        .where(
            SearchTrend.tenant_id == tenant_id,
            SearchTrend.election_id == election_id,
            SearchTrend.keyword.ilike(f"%{candidate_name}%"),
        )
        .order_by(SearchTrend.checked_at.desc())
        .limit(1)
    )).scalar()
    return float(result) if result else 0.0


async def _analyze_issue_gaps(
    db: AsyncSession,
    our_candidate_id,
    competitors: list[Candidate],
) -> list[dict]:
    """경쟁자가 커버하는 이슈 중 우리가 놓치는 것 분석."""
    gaps = []

    # 경쟁자별 이슈 카테고리 수집
    for comp in competitors:
        comp_issues = (await db.execute(
            select(CommunityPost.issue_category, func.count())
            .where(
                CommunityPost.candidate_id == comp.id,
                CommunityPost.issue_category.isnot(None),
                CommunityPost.issue_category != "",
            )
            .group_by(CommunityPost.issue_category)
        )).all()

        our_issues = (await db.execute(
            select(CommunityPost.issue_category, func.count())
            .where(
                CommunityPost.candidate_id == our_candidate_id,
                CommunityPost.issue_category.isnot(None),
                CommunityPost.issue_category != "",
            )
            .group_by(CommunityPost.issue_category)
        )).all()

        our_issue_set = {issue for issue, _ in our_issues}
        for issue, count in comp_issues:
            if issue and issue not in our_issue_set and count >= 2:
                gaps.append({
                    "area": f"이슈 커버리지 ({issue})",
                    "our_value": 0,
                    "competitor_value": count,
                    "competitor": comp.name,
                    "severity": "warning",
                    "recommendation": f"'{issue}' 이슈에 대한 우리 후보의 입장/대응 콘텐츠 필요",
                    "unit": "건",
                })

    return gaps


# ── 비교 로직 ──

def _compare_metric(
    area: str,
    our_value: float,
    comp_value: float,
    comp_name: str,
    unit: str,
    higher_is_better: bool = True,
) -> dict:
    """두 수치를 비교하여 갭/강점/동등 판정."""
    if our_value == 0 and comp_value == 0:
        return {
            "area": area,
            "our_value": our_value,
            "competitor_value": comp_value,
            "competitor": comp_name,
            "severity": "info",
            "category": "parity",
            "recommendation": f"{area} 데이터 없음 — 수집 필요",
            "unit": unit,
        }

    # 비율 계산
    if higher_is_better:
        if comp_value > 0 and our_value / comp_value < 0.3:
            severity = "critical"
        elif comp_value > 0 and our_value / comp_value < 0.6:
            severity = "warning"
        else:
            severity = "info"

        if our_value < comp_value * 0.8:
            category = "gap"
            rec = _generate_recommendation(area, our_value, comp_value, comp_name, higher_is_better)
        elif our_value > comp_value * 1.2:
            category = "strength"
            rec = f"{area}에서 {comp_name} 대비 우위"
        else:
            category = "parity"
            rec = f"{area}에서 {comp_name}과 비슷한 수준"
    else:
        # 낮을수록 좋음 (부정 비율 등)
        if our_value > 0 and comp_value > 0 and our_value / comp_value > 3:
            severity = "critical"
        elif our_value > 0 and comp_value > 0 and our_value / comp_value > 1.5:
            severity = "warning"
        else:
            severity = "info"

        if our_value > comp_value * 1.2:
            category = "gap"
            rec = _generate_recommendation(area, our_value, comp_value, comp_name, higher_is_better)
        elif our_value < comp_value * 0.8:
            category = "strength"
            rec = f"{area}에서 {comp_name} 대비 양호"
        else:
            category = "parity"
            rec = f"{area}에서 {comp_name}과 비슷한 수준"

    return {
        "area": area,
        "our_value": our_value,
        "competitor_value": comp_value,
        "competitor": comp_name,
        "severity": severity,
        "category": category,
        "recommendation": rec,
        "unit": unit,
    }


def _generate_recommendation(
    area: str, our: float, comp: float, comp_name: str, higher_is_better: bool,
) -> str:
    """갭에 대한 구체적 추천."""
    recommendations = {
        "뉴스 노출": f"뉴스 노출 {comp_name} 대비 부족 — 보도자료 배포, 언론 인터뷰 확대 필요",
        "긍정 뉴스 비율": f"긍정 여론 {comp_name} 대비 부족 — 성과/공약 중심 보도 유도 필요",
        "부정 뉴스 비율": f"부정 뉴스 비율 과다 — 위기관리 대응 및 긍정 이슈 부각 필요",
        "커뮤니티 언급": f"커뮤니티 노출 {comp_name} 대비 부족 — 맘카페/학부모 커뮤니티 소통 강화 필요",
        "유튜브 영상 수": f"유튜브 콘텐츠 {comp_name} 대비 부족 — 숏폼/설명 영상 제작 확대 필요",
        "유튜브 총 조회수": f"유튜브 조회수 {comp_name} 대비 부족 — 콘텐츠 홍보 및 SEO 최적화 필요",
        "검색량": f"검색량 {comp_name} 대비 부족 — 브랜드 인지도 향상 캠페인 필요",
    }
    return recommendations.get(area, f"{area}에서 {comp_name} 대비 개선 필요")


def _categorize(result: dict, gaps: list, strengths: list, parity: list):
    """결과를 카테고리별로 분류."""
    cat = result.pop("category", "parity")
    if cat == "gap":
        gaps.append(result)
    elif cat == "strength":
        strengths.append(result)
    else:
        parity.append(result)


async def _generate_ai_summary(
    gaps: list, strengths: list, our_name: str,
) -> str:
    """Claude CLI로 갭 분석 AI 요약."""
    claude_path = shutil.which("claude")
    if not claude_path:
        return _fallback_summary(gaps, strengths, our_name)

    prompt = (
        f"선거 경쟁자 대비 갭 분석 결과를 3줄로 요약해주세요.\n"
        f"우리 후보: {our_name}\n\n"
        f"부족한 점:\n"
    )
    for g in gaps[:5]:
        prompt += f"- {g['area']}: 우리 {g['our_value']}{g['unit']} vs {g['competitor']} {g['competitor_value']}{g['unit']} ({g['severity']})\n"
    prompt += f"\n우위:\n"
    for s in strengths[:5]:
        prompt += f"- {s['area']}: 우리 {s['our_value']}{s['unit']} vs {s['competitor']} {s['competitor_value']}{s['unit']}\n"
    prompt += "\n객관적으로, 구체적으로, 한국어로 답변."

    try:
        proc = await asyncio.create_subprocess_exec(
            claude_path, "-p", prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
        if proc.returncode == 0 and stdout:
            return stdout.decode("utf-8").strip()
    except Exception as e:
        logger.warning("ai_summary_error", error=str(e))

    return _fallback_summary(gaps, strengths, our_name)


def _fallback_summary(gaps: list, strengths: list, our_name: str) -> str:
    """AI 불가시 데이터 기반 자동 요약."""
    parts = []
    critical = [g for g in gaps if g.get("severity") == "critical"]
    warning = [g for g in gaps if g.get("severity") == "warning"]

    if critical:
        areas = ", ".join(g["area"] for g in critical[:3])
        parts.append(f"🔴 심각: {our_name}은 {areas} 영역에서 경쟁자 대비 크게 뒤처짐")
    if warning:
        areas = ", ".join(g["area"] for g in warning[:3])
        parts.append(f"🟡 주의: {areas} 영역 개선 필요")
    if strengths:
        areas = ", ".join(s["area"] for s in strengths[:3])
        parts.append(f"🟢 우위: {areas}")
    if not parts:
        parts.append(f"분석 데이터 부족 — 수집 후 재분석 필요")

    return " | ".join(parts)
