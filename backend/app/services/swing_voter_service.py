"""
ElectionPulse - Swing Voter Detection Service
커뮤니티에서 찬/반이 극명하게 갈리는 이슈를 발굴하고
캠프에 행동 유도(Call-to-Action)를 제공.
"""
import structlog
from datetime import date, timedelta
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Election, Candidate, CommunityPost, NewsArticle,
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
    스윙보터 이슈 발굴.
    커뮤니티에서 찬반이 갈리는 뜨거운 이슈를 찾아 행동 유도까지 제공.
    """
    from app.services.cache_service import get_cache, set_cache

    # 캐시 확인 (6시간 TTL)
    cache_key = f"swing_voter_{days}d"
    cached = await get_cache(db, tenant_id, election_id, cache_key, max_age_hours=6)
    if cached:
        return cached

    from app.common.election_access import get_election_tenant_ids, get_our_candidate_id
    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id = await get_our_candidate_id(db, tenant_id, election_id)

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"error": "선거 정보 없음"}

    from app.common.election_access import list_election_candidates
    candidates = await list_election_candidates(db, election_id, tenant_id=tenant_id)
    our = next((c for c in candidates if c.is_our_candidate), None)

    since = date.today() - timedelta(days=days)

    # ── 1. 이슈별 찬반 분석 (커뮤니티) ──
    issue_rows = (await db.execute(text("""
        SELECT
            issue_category,
            COUNT(*) as total,
            SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) as pos,
            SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) as neg,
            SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) as neu,
            MAX(collected_at) as latest
        FROM community_posts
        WHERE election_id = :eid
          AND issue_category IS NOT NULL
          AND collected_at >= :since
        GROUP BY issue_category
        HAVING COUNT(*) >= 2
        ORDER BY COUNT(*) DESC
    """), {"eid": str(election_id), "since": since})).all()

    # ── 2. 이슈별 최근 뜨거운 게시글 ──
    hot_issues = []
    cold_issues = []

    for row in issue_rows:
        issue, total, pos, neg, neu, latest = row
        pos = pos or 0
        neg = neg or 0
        neu = neu or 0

        # 찬반 비율 계산 (neutral 제외)
        opinions = pos + neg
        if opinions == 0:
            split_ratio = 0
        else:
            minority = min(pos, neg)
            split_ratio = round(minority / opinions * 100)  # 0%=한쪽 일색, 50%=완전 양분

        # 뜨거운 정도: 찬반 50:50에 가까울수록 + 게시글 많을수록
        heat_score = round(split_ratio * min(total / 5, 2))  # 최대 100

        # 최근 뜨거운 게시글 가져오기
        sample_posts = (await db.execute(
            select(CommunityPost.title, CommunityPost.sentiment, CommunityPost.source, CommunityPost.url)
            .where(
                CommunityPost.election_id == election_id,
                CommunityPost.issue_category == issue,
                CommunityPost.collected_at >= since,
            )
            .order_by(CommunityPost.collected_at.desc())
            .limit(5)
        )).all()

        posts_summary = [{
            "title": p[0], "sentiment": p[1], "source": p[2], "url": p[3],
        } for p in sample_posts]

        entry = {
            "issue": issue,
            "total_posts": total,
            "positive": pos,
            "negative": neg,
            "neutral": neu,
            "split_ratio": split_ratio,
            "heat_score": heat_score,
            "latest": latest.strftime("%Y-%m-%d") if latest else None,
            "verdict": _get_verdict(split_ratio, total),
            "sample_posts": posts_summary,
        }

        if heat_score >= 30 or split_ratio >= 30:
            hot_issues.append(entry)
        else:
            cold_issues.append(entry)

    # 뜨거운 순 정렬
    hot_issues.sort(key=lambda x: -x["heat_score"])
    cold_issues.sort(key=lambda x: -x["heat_score"])

    # ── 3. 뉴스에서도 찬반 갈리는 이슈 보강 ──
    news_controversial = await _find_controversial_news(db, all_tids, election_id, since)

    # ── 4. AI 행동 유도 — 별도 요청으로 분리 (페이지 로딩 속도 개선) ──
    recommendations = []

    result = {
        "hot_issues": hot_issues,
        "cold_issues": cold_issues,
        "news_controversial": news_controversial,
        "recommendations": recommendations,
        "total_issues": len(issue_rows),
        "hot_count": len(hot_issues),
        "period": f"최근 {days}일",
        "our_candidate": our.name if our else None,
    }

    # 캐시 저장
    await set_cache(db, tenant_id, election_id, cache_key, result)
    return result


def _get_verdict(split_ratio: int, total: int) -> str:
    """찬반 비율에 따른 판정."""
    if split_ratio >= 40:
        return "극심한 찬반 대립 — 즉시 입장 표명 필요"
    elif split_ratio >= 25:
        return "의견 갈림 — 스탠스 확인 권장"
    elif split_ratio >= 10:
        return "약간의 반대 의견 — 모니터링"
    else:
        return "한쪽 우세 — 안정"


async def _find_controversial_news(db, all_tids, election_id, since) -> list:
    """뉴스에서 같은 주제인데 긍/부정이 섞인 기사들."""
    rows = (await db.execute(text("""
        SELECT
            SUBSTRING(title, 1, 10) as topic_prefix,
            COUNT(*) as cnt,
            SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) as pos,
            SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) as neg
        FROM news_articles
        WHERE election_id = :eid
          AND collected_at >= :since AND sentiment IS NOT NULL
        GROUP BY SUBSTRING(title, 1, 10)
        HAVING COUNT(*) >= 3
          AND SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) >= 1
          AND SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) >= 1
        ORDER BY COUNT(*) DESC
        LIMIT 5
    """), {"eid": str(election_id), "since": since})).all()

    return [{
        "topic": row[0], "total": row[1], "positive": row[2], "negative": row[3],
    } for row in rows]


async def _generate_recommendations(
    hot_issues: list, our_name: str, election, db, tenant_id: str,
) -> list:
    """AI가 뜨거운 이슈별 행동 유도(Call-to-Action) 생성."""
    issues_text = "\n".join(
        f"- {h['issue']}: 찬성 {h['positive']}건 vs 반대 {h['negative']}건 (찬반비율 {h['split_ratio']}%), 총 {h['total_posts']}건"
        for h in hot_issues
    )

    prompt = (
        f"선거 캠프 전략가로서, 커뮤니티에서 찬반이 갈리는 이슈에 대한 행동 유도를 작성하세요.\n\n"
        f"선거: {election.name}\n"
        f"우리 후보: {our_name}\n\n"
        f"[뜨거운 이슈]\n{issues_text}\n\n"
        f"각 이슈별로 아래 JSON 배열 형식으로 답변하세요:\n"
        f'[{{"issue": "이슈명", "situation": "현재 상황 1줄 요약", "action": "구체적 행동 지침 (유튜브 쇼츠/블로그/기자회견 등)", "message_example": "실제 사용할 수 있는 메시지 예시 1줄"}}]\n\n'
        f"규칙:\n"
        f"- situation: '현재 맘카페에서 ~가 뜨겁습니다' 형식\n"
        f"- action: 구체적 채널 + 콘텐츠 형태 명시\n"
        f"- message_example: 후보가 바로 쓸 수 있는 문구\n"
        f"- 선거법 위반 소지 없도록"
    )

    result = await call_claude(prompt, timeout=300, context="swing_voter_cta", tenant_id=tenant_id, db=db)

    if result and "items" in result:
        return result["items"][:5]
    elif result and isinstance(result, list):
        return result[:5]

    # Fallback
    return [{
        "issue": h["issue"],
        "situation": f"커뮤니티에서 '{h['issue']}' 관련 찬반 {h['split_ratio']}% 대립 중",
        "action": f"'{h['issue']}' 관련 {our_name} 후보 입장을 유튜브 쇼츠로 제작하여 스윙보터 흡수",
        "message_example": f"{our_name} 후보의 '{h['issue']}' 정책을 확인하세요",
    } for h in hot_issues[:3]]
