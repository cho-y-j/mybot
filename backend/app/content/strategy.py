"""
ElectionPulse - AI Content Strategy Engine (B3)
실제 데이터 기반 콘텐츠 전략 추천.
검색 트렌드, 경쟁자 분석, 선거법 검증 통합.
"""
import asyncio
import shutil
from datetime import date, timedelta
from typing import Optional

import structlog
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Election, Candidate, NewsArticle, CommunityPost,
    YouTubeVideo, SearchTrend,
)
from app.content.compliance import ComplianceChecker
from app.content.keyword_engine import (
    generate_hashtags, generate_blog_tags, BLOG_TAG_CATEGORIES,
)

logger = structlog.get_logger()
compliance_checker = ComplianceChecker()


async def generate_content_strategy(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
) -> dict:
    """
    AI 기반 콘텐츠 전략 생성.
    Returns: {
        "blog_topics": [...],
        "youtube_topics": [...],
        "hashtag_sets": {...},
        "keyword_opportunities": [...],
        "ai_outlines": [...],
        "compliance_notes": [...],
    }
    """
    # 기본 데이터 로드
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"error": "선거 정보 없음"}

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == tenant_id,
            Candidate.enabled == True,
        ).order_by(Candidate.priority)
    )).scalars().all()

    our = next((c for c in candidates if c.is_our_candidate), None)
    competitors = [c for c in candidates if not c.is_our_candidate]
    d_day = (election.election_date - date.today()).days

    # 데이터 수집
    trending_issues = await _get_trending_issues(db, tenant_id, election_id)
    competitor_topics = await _get_competitor_topics(db, competitors)
    our_coverage = await _get_our_coverage(db, our) if our else {}
    search_data = await _get_search_data(db, tenant_id, election_id)

    # 전략 생성
    blog_topics = _generate_blog_topics(
        election, our, competitors, trending_issues,
        competitor_topics, our_coverage, d_day,
    )
    youtube_topics = _generate_youtube_topics(
        election, our, competitors, competitor_topics, d_day,
    )
    keyword_opps = _find_keyword_opportunities(search_data, our_coverage)

    # 해시태그 세트
    region_short = (election.region_sido or "")[:2]
    hashtag_sets = {}
    if our:
        hashtag_sets = generate_hashtags(
            election_type=election.election_type,
            region_short=region_short,
            candidate_name=our.name,
            candidate_party=our.party,
            sigungu=election.region_sigungu,
        )

    # 블로그 아웃라인 (Claude 없이 빠른 fallback만 — AI는 수동 트리거)
    ai_outlines = []
    for topic in blog_topics[:3]:
        outline = _fallback_outline(topic, our)
        if outline:
            ai_outlines.append(outline)

    # 선거법 주의사항
    compliance_notes = _get_compliance_notes(election, d_day)

    return {
        "blog_topics": blog_topics,
        "youtube_topics": youtube_topics,
        "hashtag_sets": hashtag_sets,
        "keyword_opportunities": keyword_opps,
        "ai_outlines": ai_outlines,
        "compliance_notes": compliance_notes,
        "our_candidate": our.name if our else None,
        "d_day": d_day,
    }


# ── 데이터 수집 ──

async def _get_trending_issues(
    db: AsyncSession, tenant_id: str, election_id: str,
) -> list[dict]:
    """현재 트렌딩 이슈 (검색량 + 뉴스 건수 기반)."""
    week_ago = date.today() - timedelta(days=7)

    # 검색 트렌드 상위
    trends = (await db.execute(
        select(SearchTrend)
        .where(
            SearchTrend.tenant_id == tenant_id,
            SearchTrend.election_id == election_id,
        )
        .order_by(SearchTrend.checked_at.desc())
        .limit(20)
    )).scalars().all()

    # 커뮤니티 이슈 빈도
    issue_counts = (await db.execute(
        select(CommunityPost.issue_category, func.count())
        .where(
            CommunityPost.election_id == election_id,
            CommunityPost.issue_category.isnot(None),
            CommunityPost.issue_category != "",
            func.date(CommunityPost.collected_at) >= week_ago,
        )
        .group_by(CommunityPost.issue_category)
        .order_by(func.count().desc())
        .limit(10)
    )).all()

    issues = []
    for issue, count in issue_counts:
        issues.append({
            "issue": issue,
            "community_mentions": count,
            "source": "community",
        })

    for t in trends:
        issues.append({
            "issue": t.keyword,
            "search_volume": t.relative_volume or t.search_volume or 0,
            "source": "search",
        })

    return issues


async def _get_competitor_topics(
    db: AsyncSession, competitors: list[Candidate],
) -> list[dict]:
    """경쟁자가 다루는 주제/이슈."""
    topics = []
    for comp in competitors:
        # 뉴스 키워드
        news = (await db.execute(
            select(NewsArticle.title)
            .where(NewsArticle.candidate_id == comp.id)
            .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
            .limit(10)
        )).scalars().all()

        # 유튜브 주제
        videos = (await db.execute(
            select(YouTubeVideo.title, YouTubeVideo.views)
            .where(YouTubeVideo.candidate_id == comp.id)
            .order_by(YouTubeVideo.views.desc())
            .limit(5)
        )).all()

        for title in news:
            topics.append({
                "competitor": comp.name,
                "type": "news",
                "title": title,
            })
        for title, views in videos:
            topics.append({
                "competitor": comp.name,
                "type": "youtube",
                "title": title,
                "views": views or 0,
            })

    return topics


async def _get_our_coverage(db: AsyncSession, our: Candidate) -> dict:
    """우리 후보의 기존 콘텐츠 커버리지."""
    news_titles = (await db.execute(
        select(NewsArticle.title)
        .where(NewsArticle.candidate_id == our.id)
        .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc())
        .limit(20)
    )).scalars().all()

    video_titles = (await db.execute(
        select(YouTubeVideo.title)
        .where(YouTubeVideo.candidate_id == our.id)
    )).scalars().all()

    community_issues = (await db.execute(
        select(CommunityPost.issue_category)
        .where(
            CommunityPost.candidate_id == our.id,
            CommunityPost.issue_category.isnot(None),
        )
    )).scalars().all()

    return {
        "news_titles": list(news_titles),
        "video_titles": list(video_titles),
        "covered_issues": list(set(community_issues)),
    }


async def _get_search_data(
    db: AsyncSession, tenant_id: str, election_id: str,
) -> list[dict]:
    """검색 트렌드 데이터."""
    trends = (await db.execute(
        select(SearchTrend)
        .where(
            SearchTrend.tenant_id == tenant_id,
            SearchTrend.election_id == election_id,
        )
        .order_by(SearchTrend.checked_at.desc())
        .limit(30)
    )).scalars().all()

    return [{
        "keyword": t.keyword,
        "volume": t.relative_volume or t.search_volume or 0,
        "platform": t.platform,
        "related": t.related_terms or [],
    } for t in trends]


# ── 전략 생성 ──

def _generate_blog_topics(
    election, our, competitors, trending_issues,
    competitor_topics, our_coverage, d_day,
) -> list[dict]:
    """블로그 주제 추천 (데이터 기반)."""
    topics = []
    region = election.region_sido or ""
    our_name = our.name if our else "후보"
    election_label = {
        "superintendent": "교육감",
        "mayor": "시장",
        "governor": "도지사",
        "congressional": "국회의원",
    }.get(election.election_type, "선거")

    # 1. 트렌딩 이슈 기반 (검색량 높은 주제)
    for issue in trending_issues[:5]:
        topic_name = issue.get("issue", "")
        if not topic_name:
            continue
        priority = "high" if issue.get("search_volume", 0) > 50 or issue.get("community_mentions", 0) > 5 else "medium"
        topics.append({
            "title": f"{region} {topic_name} 현황과 {our_name}의 해결 방안",
            "reason": f"검색/커뮨 트렌딩 ({issue.get('source', 'data')})",
            "priority": priority,
            "type": "blog",
            "tags": [topic_name, region, our_name, election_label],
            "data_source": issue,
        })

    # 2. 경쟁자 선점 주제 대응
    comp_only_topics = set()
    covered = set(t.lower() for t in (our_coverage.get("news_titles", []) + our_coverage.get("video_titles", [])))
    for ct in competitor_topics:
        title_lower = ct.get("title", "").lower()
        already_covered = any(kw in title_lower for kw in covered) if covered else False
        if not already_covered and ct.get("title"):
            comp_only_topics.add((ct["competitor"], ct["title"][:30]))

    for comp_name, title_snippet in list(comp_only_topics)[:3]:
        topics.append({
            "title": f"{our_name}의 관점: {title_snippet}",
            "reason": f"{comp_name}이 다루는 주제 — 우리 관점 필요",
            "priority": "high",
            "type": "blog",
            "tags": [our_name, election_label],
        })

    # 3. D-day 기반 시의성 주제
    if d_day <= 30:
        topics.append({
            "title": f"D-{d_day} {our_name} 핵심 공약 총정리",
            "reason": "선거일 임박 — 공약 정리 콘텐츠 수요 증가",
            "priority": "high",
            "type": "blog",
            "tags": [our_name, "공약", election_label, region],
        })
    if d_day <= 14:
        topics.append({
            "title": f"{region} {election_label} 후보 비교 (객관적 분석)",
            "reason": "선거운동 기간 — 비교 분석 콘텐츠 검색량 급증",
            "priority": "high",
            "type": "blog",
            "tags": ["후보비교", region, election_label],
        })

    return topics


def _generate_youtube_topics(
    election, our, competitors, competitor_topics, d_day,
) -> list[dict]:
    """유튜브 주제 추천."""
    topics = []
    our_name = our.name if our else "후보"
    region = election.region_sido or ""

    # 경쟁자 인기 영상 분석
    popular_comp_videos = [
        ct for ct in competitor_topics
        if ct["type"] == "youtube" and ct.get("views", 0) > 100
    ]
    popular_comp_videos.sort(key=lambda x: x.get("views", 0), reverse=True)

    # 1. 경쟁자 인기 포맷 벤치마킹
    for vid in popular_comp_videos[:2]:
        topics.append({
            "title": f"{our_name} 관점: {vid['title'][:30]}",
            "reason": f"{vid['competitor']} 인기 영상 ({vid.get('views', 0):,}회) 대응",
            "priority": "high",
            "type": "youtube",
            "format": "long" if vid.get("views", 0) > 1000 else "short",
        })

    # 2. 표준 콘텐츠
    standard_topics = [
        {
            "title": f"{our_name} 1분 공약 요약 (숏폼)",
            "reason": "숏폼 콘텐츠 — 젊은 유권자 도달",
            "priority": "high",
            "type": "youtube",
            "format": "short",
        },
        {
            "title": f"{our_name} 현장 방문 브이로그",
            "reason": "진정성 어필 — 현장감 있는 콘텐츠",
            "priority": "medium",
            "type": "youtube",
            "format": "long",
        },
    ]

    if d_day <= 30:
        standard_topics.append({
            "title": f"D-{d_day} {our_name}에게 직접 듣는 핵심 공약",
            "reason": "선거 임박 — 직접 소통 콘텐츠",
            "priority": "high",
            "type": "youtube",
            "format": "long",
        })

    topics.extend(standard_topics)
    return topics


def _find_keyword_opportunities(
    search_data: list[dict],
    our_coverage: dict,
) -> list[dict]:
    """검색량 높지만 우리가 다루지 않는 키워드 기회."""
    opportunities = []
    covered_text = " ".join(
        our_coverage.get("news_titles", []) + our_coverage.get("video_titles", [])
    ).lower()

    for sd in search_data:
        keyword = sd.get("keyword", "")
        volume = sd.get("volume", 0)
        if not keyword or volume <= 0:
            continue

        is_covered = keyword.lower() in covered_text
        if not is_covered and volume > 10:
            opportunities.append({
                "keyword": keyword,
                "search_volume": volume,
                "platform": sd.get("platform", "naver"),
                "related_terms": sd.get("related", [])[:5],
                "recommendation": f"'{keyword}' 관련 블로그/영상 제작 추천 (검색량 {volume})",
            })

    opportunities.sort(key=lambda x: x["search_volume"], reverse=True)
    return opportunities[:10]


def _get_compliance_notes(election, d_day: int) -> list[dict]:
    """현재 시점의 선거법 주의사항."""
    notes = []

    if d_day <= 0:
        notes.append({
            "level": "critical",
            "rule": "선거 종료",
            "detail": "선거가 종료되었습니다. 선거운동 콘텐츠 게시 불가.",
        })
    elif d_day <= 1:
        notes.append({
            "level": "critical",
            "rule": "선거 전일",
            "detail": "선거운동 금지 기간. 투표 독려 외 모든 선거운동 불가.",
        })
    elif d_day <= 6:
        notes.append({
            "level": "warning",
            "rule": "여론조사 공표 금지",
            "detail": "선거일 6일 전부터 여론조사 결과 공표/인용 금지.",
        })
    elif d_day <= 14:
        notes.append({
            "level": "warning",
            "rule": "공식 선거운동 기간",
            "detail": "모든 콘텐츠에 '선거운동정보' 표기 필수.",
        })
    elif d_day <= 90:
        notes.append({
            "level": "info",
            "rule": "딥페이크 금지",
            "detail": "선거일 90일 전부터 AI 딥페이크 영상/이미지 사용 금지.",
        })

    # 공통 주의사항
    notes.append({
        "level": "info",
        "rule": "AI 생성물 표기",
        "detail": "AI 활용 콘텐츠에는 반드시 [AI 생성물] 또는 [AI 활용] 표기 필수.",
    })

    return notes


# ── AI 블로그 아웃라인 생성 ──

async def _generate_blog_outline(
    topic: dict,
    election,
    our: Optional[Candidate],
    d_day: int,
) -> Optional[dict]:
    """Claude CLI로 블로그 포스트 아웃라인 생성."""
    claude_path = shutil.which("claude")
    if not claude_path:
        return _fallback_outline(topic, our)

    our_name = our.name if our else "후보"
    prompt = (
        f"선거 블로그 포스트 아웃라인을 작성해주세요.\n\n"
        f"주제: {topic['title']}\n"
        f"선거: {election.name} (D-{d_day})\n"
        f"후보: {our_name}\n"
        f"작성 이유: {topic.get('reason', '')}\n\n"
        f"형식:\n"
        f"1. 제목 (SEO 최적화, 30자 이내)\n"
        f"2. 도입부 (2-3문장)\n"
        f"3. 본문 소제목 3-4개\n"
        f"4. 결론 방향\n"
        f"5. 추천 해시태그 5개\n\n"
        f"주의: 선거법 준수, 비방 금지, 객관적 톤.\n"
        f"한국어로 간결하게 답변."
    )

    try:
        proc = await asyncio.create_subprocess_exec(
            claude_path, "-p", prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=180)
        if proc.returncode == 0 and stdout:
            outline_text = stdout.decode("utf-8").strip()
            if len(outline_text) > 30:
                return {
                    "topic": topic["title"],
                    "outline": outline_text,
                    "ai_generated": True,
                    "compliance_check": compliance_checker.check_content(
                        outline_text, content_type="blog",
                        election_date=election.election_date.isoformat(),
                    ),
                }
    except Exception as e:
        logger.warning("blog_outline_ai_error", error=str(e))

    return _fallback_outline(topic, our)


def _fallback_outline(topic: dict, our: Optional[Candidate]) -> dict:
    """AI 불가시 기본 아웃라인."""
    our_name = our.name if our else "후보"
    return {
        "topic": topic["title"],
        "outline": (
            f"제목: {topic['title']}\n"
            f"1. 현황 분석\n"
            f"2. {our_name}의 입장/공약\n"
            f"3. 기대 효과\n"
            f"4. 마무리\n"
            f"태그: {', '.join(topic.get('tags', []))}"
        ),
        "ai_generated": False,
    }
