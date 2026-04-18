"""
ElectionPulse - Competitor Gap Analysis (B2)
우리 후보가 경쟁자 대비 부족한 점을 객관적으로 분석.
실제 DB 데이터 기반, 모든 수치는 실데이터.
"""
import json
from datetime import date, timedelta
from typing import Optional

import structlog
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Candidate, NewsArticle, CommunityPost,
    YouTubeVideo, SearchTrend, Survey,
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

    from app.common.election_access import get_election_tenant_ids, get_our_candidate_id
    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id = await get_our_candidate_id(db, tenant_id, election_id)

    from app.common.election_access import list_election_candidates
    candidates = await list_election_candidates(db, election_id, tenant_id=tenant_id)
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

    # ── 2. 긍정/부정 비율 비교 (neutral 제외한 유효 감성 기준) ──
    our_sent = await _get_sentiment_ratio(db, our.id, since)
    for comp in competitors:
        comp_sent = await _get_sentiment_ratio(db, comp.id, since)

        # 유효 감성 건수 경고 (neutral이 너무 많으면 신뢰도 낮음)
        our_quality = "low" if our_sent["neutral_rate"] > 70 else "good"
        comp_quality = "low" if comp_sent["neutral_rate"] > 70 else "good"

        result = _compare_metric(
            area="긍정 뉴스 비율",
            our_value=round(our_sent["pos_rate"], 1),
            comp_value=round(comp_sent["pos_rate"], 1),
            comp_name=comp.name,
            unit="%",
            higher_is_better=True,
        )
        result["our_effective"] = our_sent["effective_count"]
        result["comp_effective"] = comp_sent["effective_count"]
        result["quality_warning"] = our_quality == "low" or comp_quality == "low"
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
        result_neg["our_effective"] = our_sent["effective_count"]
        result_neg["comp_effective"] = comp_sent["effective_count"]
        result_neg["quality_warning"] = our_quality == "low" or comp_quality == "low"
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

    # ── 6. 여론조사 지지율 비교 ──
    our_support = await _get_latest_support(db, tenant_id, election_id, our.name)
    for comp in competitors:
        comp_support = await _get_latest_support(db, tenant_id, election_id, comp.name)
        if our_support > 0 or comp_support > 0:
            result = _compare_metric(
                area="여론조사 지지율",
                our_value=our_support,
                comp_value=comp_support,
                comp_name=comp.name,
                unit="%p",
                higher_is_better=True,
            )
            _categorize(result, gaps, strengths, parity)

    # ── 7. 유튜브 참여율 비교 ──
    our_engagement = await _get_youtube_engagement(db, our.id)
    for comp in competitors:
        comp_engagement = await _get_youtube_engagement(db, comp.id)
        if our_engagement > 0 or comp_engagement > 0:
            result = _compare_metric(
                area="유튜브 참여율",
                our_value=our_engagement,
                comp_value=comp_engagement,
                comp_name=comp.name,
                unit="%",
                higher_is_better=True,
            )
            _categorize(result, gaps, strengths, parity)

    # ── 8. 이슈 커버리지 갭 분석 ──
    issue_gaps = await _analyze_issue_gaps(db, our.id, competitors)
    gaps.extend(issue_gaps)

    # severity 기준으로 정렬
    severity_order = {"critical": 0, "warning": 1, "info": 2}
    gaps.sort(key=lambda x: severity_order.get(x.get("severity", "info"), 9))

    # ── AI 요약 생성 ──
    # AI 요약은 수동 트리거 시에만 생성 — 기본은 fallback
    ai_summary = _fallback_summary(gaps, strengths, our.name)

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

    neutral = total - pos - neg
    effective = pos + neg  # neutral 제외 — 감성 판단된 건만 비율 계산
    return {
        "total": total,
        "positive": pos,
        "negative": neg,
        "neutral": neutral,
        "effective_count": effective,
        "pos_rate": (pos / effective * 100) if effective > 0 else 50,
        "neg_rate": (neg / effective * 100) if effective > 0 else 50,
        "neutral_rate": (neutral / total * 100) if total > 0 else 0,
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


async def _get_latest_support(
    db: AsyncSession, tenant_id: str, election_id: str, candidate_name: str,
) -> float:
    """최신 여론조사에서 후보 지지율 가져오기."""
    import json as _json
    surveys = (await db.execute(
        select(Survey).where(
            Survey.tenant_id == tenant_id,
            Survey.election_id == election_id,
        ).order_by(Survey.survey_date.desc()).limit(3)
    )).scalars().all()

    for s in surveys:
        results = s.results
        if isinstance(results, str):
            try:
                results = _json.loads(results)
            except:
                continue
        if isinstance(results, dict) and candidate_name in results:
            val = results[candidate_name]
            if isinstance(val, (int, float)) and val > 0:
                return float(val)
    return 0.0


async def _get_youtube_engagement(db: AsyncSession, candidate_id) -> float:
    """유튜브 참여율 (좋아요+댓글)/조회수 %."""
    stats = await _get_youtube_stats(db, candidate_id)
    likes = (await db.execute(
        select(func.coalesce(func.sum(YouTubeVideo.likes), 0))
        .where(YouTubeVideo.candidate_id == candidate_id)
    )).scalar() or 0
    comments = (await db.execute(
        select(func.coalesce(func.sum(YouTubeVideo.comments_count), 0))
        .where(YouTubeVideo.candidate_id == candidate_id)
    )).scalar() or 0
    views = stats["views"]
    if views > 0:
        return round((int(likes) + int(comments)) / views * 100, 2)
    return 0.0


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

    detail = f"{area}: {our_value}{unit} vs {comp_name} {comp_value}{unit}"

    return {
        "area": area,
        "our_value": our_value,
        "competitor_value": comp_value,
        "competitor": comp_name,
        "severity": severity,
        "category": category,
        "recommendation": rec,
        "detail": detail,
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
        "여론조사 지지율": f"지지율 {comp_name} 대비 열세 — 핵심 공약 어필 및 타겟 유권자 대응 전략 필요",
        "유튜브 참여율": f"유튜브 참여율 {comp_name} 대비 부족 — 댓글 유도, 공유 이벤트 등 인게이지먼트 강화",
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
    tenant_id: str | None = None, db=None,
) -> str:
    """갭 분석 AI 요약. ai_service.call_claude_text 경유 — 고객 API키 자동 사용."""
    from app.services.ai_service import call_claude_text

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
        text = await call_claude_text(
            prompt, timeout=180,
            context="competitor_gap_summary",
            tenant_id=tenant_id, db=db,
        )
        if text:
            return text
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
