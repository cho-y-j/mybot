"""
ElectionPulse - Swing Voter Detection Service
지역 민감 이슈 + 커뮤니티 부정 감성 교차 분석.
"""
import structlog
from collections import Counter
from datetime import date, timedelta
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Election, Candidate, CommunityPost,
)
from app.services.ai_service import call_claude

logger = structlog.get_logger()


async def detect_swing_indicators(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    days: int = 30,
) -> dict:
    """
    스윙보터 키워드 탐지.
    regional_boost + 커뮤니티 부정 감성 교차 분석.
    Returns: {swing_issues[], safe_issues[], overall_risk, recommendations}
    """
    from app.common.election_access import get_election_tenant_ids
    all_tids = await get_election_tenant_ids(db, election_id)

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"error": "선거 정보 없음"}

    region = election.region_sido or ""
    election_type = election.election_type or "superintendent"

    # 1. 지역 이슈 트렌드 (regional_boost)
    regional_trends = {}
    try:
        from app.collectors.keyword_tracker import KeywordTracker
        tracker = KeywordTracker()
        regional_data = await tracker.get_regional_issue_trends(
            election_type, region, days=days
        )
        for keyword, data in regional_data.items():
            regional_trends[keyword] = {
                "regional_boost": data.get("regional_boost", 0),
                "avg_7d": data.get("avg_7d", 0),
                "trend": data.get("trend", "stable"),
            }
    except Exception as e:
        logger.warning("swing_regional_trends_error", error=str(e)[:200])

    # 2. 커뮤니티 이슈별 감성 분석
    since = date.today() - timedelta(days=days)
    community_sentiment = {}

    posts = (await db.execute(
        select(CommunityPost).where(
            CommunityPost.tenant_id.in_(all_tids),
            CommunityPost.election_id == election_id,
            CommunityPost.issue_category.isnot(None),
            func.date(CommunityPost.collected_at) >= since,
        )
    )).scalars().all()

    # 이슈별 감성 집계
    issue_stats: dict = {}
    for p in posts:
        issue = p.issue_category
        if issue not in issue_stats:
            issue_stats[issue] = {"total": 0, "negative": 0, "positive": 0}
        issue_stats[issue]["total"] += 1
        if p.sentiment == "negative":
            issue_stats[issue]["negative"] += 1
        elif p.sentiment == "positive":
            issue_stats[issue]["positive"] += 1

    for issue, stats in issue_stats.items():
        neg_ratio = stats["negative"] / max(stats["total"], 1) * 100
        community_sentiment[issue] = {
            "total": stats["total"],
            "negative": stats["negative"],
            "positive": stats["positive"],
            "negative_ratio": round(neg_ratio, 1),
        }

    # 3. 교차 분석: regional_boost > 30 + 부정률 > 50% = 고위험 스윙 이슈
    swing_issues = []
    safe_issues = []

    # 모든 이슈 키워드를 통합 분석
    all_keywords = set(list(regional_trends.keys()) + list(community_sentiment.keys()))

    for keyword in all_keywords:
        rt = regional_trends.get(keyword, {})
        cs = community_sentiment.get(keyword, {})

        regional_boost = rt.get("regional_boost", 0)
        neg_ratio = cs.get("negative_ratio", 0)
        total_posts = cs.get("total", 0)

        risk_score = 0
        # 지역 관심도가 높을수록 위험
        if regional_boost > 30:
            risk_score += min(regional_boost / 100 * 50, 50)
        # 부정 감성이 높을수록 위험
        if neg_ratio > 30:
            risk_score += min(neg_ratio / 100 * 50, 50)
        # 게시글 수가 많을수록 영향력 증가
        if total_posts >= 5:
            risk_score *= 1.2

        risk_score = round(min(risk_score, 100), 1)

        entry = {
            "issue": keyword,
            "risk_score": risk_score,
            "regional_boost": regional_boost,
            "negative_ratio": neg_ratio,
            "total_posts": total_posts,
            "trend": rt.get("trend", "unknown"),
            "recommendation": "",
        }

        # 추천 생성
        if risk_score >= 50:
            entry["recommendation"] = f"'{keyword}' 이슈에서 유권자 이탈 위험. 즉시 우리 후보 입장 발표/콘텐츠 필요"
            swing_issues.append(entry)
        elif risk_score >= 25:
            entry["recommendation"] = f"'{keyword}' 이슈 모니터링 강화 권장"
            swing_issues.append(entry)
        else:
            entry["recommendation"] = "안정"
            safe_issues.append(entry)

    # 위험도 순 정렬
    swing_issues.sort(key=lambda x: -x["risk_score"])
    safe_issues.sort(key=lambda x: -x["risk_score"])

    # 전체 위험도 판단
    max_risk = max((s["risk_score"] for s in swing_issues), default=0)
    overall_risk = "high" if max_risk >= 60 else ("medium" if max_risk >= 30 else "low")

    # AI 추천 (상위 3개 이슈에 대해)
    recommendations = []
    if swing_issues[:3]:
        top_issues = [s["issue"] for s in swing_issues[:3]]
        ai_prompt = (
            f"선거 캠프 전략가로서, 다음 스윙보터 이탈 위험 이슈에 대한 대응 전략을 제안하세요:\n\n"
            + "\n".join(f"- {s['issue']} (위험도 {s['risk_score']}%, 부정률 {s['negative_ratio']}%)" for s in swing_issues[:3])
            + f"\n\n선거: {election.name}, 지역: {region}\n"
            + "각 이슈별 1줄 대응 전략을 JSON 배열로: [{\"issue\": \"이슈\", \"strategy\": \"전략\"}]"
        )
        ai_result = await call_claude(ai_prompt, timeout=30, context="swing_voter_strategy", tenant_id=tenant_id, db=db)
        if ai_result and "items" in ai_result:
            recommendations = ai_result["items"][:3]
        elif ai_result and isinstance(ai_result, dict):
            recommendations = [ai_result]

    return {
        "swing_issues": swing_issues,
        "safe_issues": safe_issues,
        "overall_risk": overall_risk,
        "total_issues_analyzed": len(all_keywords),
        "recommendations": recommendations,
        "period": f"최근 {days}일",
    }
