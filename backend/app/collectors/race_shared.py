"""
P2-01 Race-Shared 수집/조회 헬퍼.

목적: 같은 선거에 여러 캠프가 가입했을 때 중복 수집 제거.
사용: 기존 collectors/tasks.py의 news 수집이 이 헬퍼를 호출하면
      자동으로 race_news_articles에 dedup된 1건이 저장되고,
      각 캠프는 race_news_camp_analysis에 자기 관점만 overlay.

현재 상태 (2026-04-12): PoC 단계. 기존 news_articles 흐름은 그대로 유지.
이 모듈은 미래 전환을 위한 기반 API.
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession


def upsert_race_news_sync(
    session: Session,
    election_id: str,
    title: str,
    url: str,
    source: str = "",
    summary: str = "",
    platform: str = "naver",
    published_at: Optional[datetime] = None,
) -> str:
    """Race-shared 뉴스 1건 UPSERT. 이미 있으면 id만 반환.

    Returns: race_news_articles.id (str)
    """
    # pg_insert ON CONFLICT DO UPDATE — published_at NULL일 때만 백필
    row = session.execute(text("""
        INSERT INTO race_news_articles
            (id, election_id, title, url, source, summary, platform,
             published_at, collected_at)
        VALUES
            (gen_random_uuid(), :eid, :title, :url, :source, :summary, :platform,
             :pub, NOW())
        ON CONFLICT (election_id, url) DO UPDATE SET
            published_at = COALESCE(race_news_articles.published_at, EXCLUDED.published_at),
            title = EXCLUDED.title,
            source = EXCLUDED.source,
            summary = COALESCE(NULLIF(race_news_articles.summary, ''), EXCLUDED.summary)
        RETURNING id
    """), {
        "eid": str(election_id),
        "title": title[:500],
        "url": url[:1000],
        "source": (source or "")[:200],
        "summary": summary or "",
        "platform": platform[:50],
        "pub": published_at,
    }).scalar_one()
    return str(row)


def upsert_camp_analysis_sync(
    session: Session,
    race_news_id: str,
    tenant_id: str,
    candidate_id: Optional[str] = None,
    is_about_our_candidate: bool = False,
    strategic_quadrant: Optional[str] = None,
    sentiment: Optional[str] = None,
    action_type: Optional[str] = None,
    action_priority: Optional[str] = None,
    action_summary: Optional[str] = None,
    ai_reason: Optional[str] = None,
) -> None:
    """캠프별 관점 분석 결과 upsert. race_news_id에 이미 분석 있으면 교체."""
    session.execute(text("""
        INSERT INTO race_news_camp_analysis
            (race_news_id, tenant_id, candidate_id,
             is_about_our_candidate, strategic_quadrant, strategic_value,
             action_type, action_priority, action_summary, ai_reason,
             updated_at)
        VALUES
            (:rid, :tid, :cid,
             :is_ours, :q, :q,
             :atype, :apri, :asum, :reason,
             NOW())
        ON CONFLICT (race_news_id, tenant_id) DO UPDATE SET
            candidate_id = EXCLUDED.candidate_id,
            is_about_our_candidate = EXCLUDED.is_about_our_candidate,
            strategic_quadrant = EXCLUDED.strategic_quadrant,
            strategic_value = EXCLUDED.strategic_value,
            action_type = EXCLUDED.action_type,
            action_priority = EXCLUDED.action_priority,
            action_summary = EXCLUDED.action_summary,
            ai_reason = EXCLUDED.ai_reason,
            updated_at = NOW()
    """), {
        "rid": race_news_id,
        "tid": str(tenant_id),
        "cid": str(candidate_id) if candidate_id else None,
        "is_ours": is_about_our_candidate,
        "q": strategic_quadrant,
        "atype": action_type,
        "apri": action_priority,
        "asum": action_summary,
        "reason": ai_reason,
    })


async def upsert_race_news_async(
    db: AsyncSession,
    election_id: str,
    title: str,
    url: str,
    source: str = "",
    summary: str = "",
    platform: str = "naver",
    published_at: Optional[datetime] = None,
) -> str:
    """Async 버전 (instant.py 등 AsyncSession 경로용)."""
    row = await db.execute(text("""
        INSERT INTO race_news_articles
            (id, election_id, title, url, source, summary, platform,
             published_at, collected_at)
        VALUES
            (gen_random_uuid(), :eid, :title, :url, :source, :summary, :platform,
             :pub, NOW())
        ON CONFLICT (election_id, url) DO UPDATE SET
            published_at = COALESCE(race_news_articles.published_at, EXCLUDED.published_at),
            title = EXCLUDED.title,
            source = EXCLUDED.source
        RETURNING id
    """), {
        "eid": str(election_id),
        "title": title[:500],
        "url": url[:1000],
        "source": (source or "")[:200],
        "summary": summary or "",
        "platform": platform[:50],
        "pub": published_at,
    })
    return str(row.scalar_one())


async def query_race_news_for_tenant(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    strategic_quadrant: Optional[str] = None,
    limit: int = 30,
) -> list[dict]:
    """테넌트 관점으로 race-shared 뉴스 조회.

    캠프별 분석(weakness/opportunity 등)은 race_news_camp_analysis에서,
    원본 데이터(title/url/published_at 등)는 race_news_articles에서.
    """
    quadrant_clause = ""
    params = {
        "tid": str(tenant_id),
        "eid": str(election_id),
        "limit": limit,
    }
    if strategic_quadrant:
        quadrant_clause = "AND ca.strategic_quadrant = :q"
        params["q"] = strategic_quadrant

    rows = (await db.execute(text(f"""
        SELECT
            rn.id, rn.title, rn.url, rn.source, rn.summary, rn.platform,
            rn.published_at, rn.collected_at,
            rn.ai_summary, rn.ai_topics, rn.ai_threat_level,
            rn.sentiment, rn.sentiment_score, rn.sentiment_verified,
            ca.candidate_id, ca.is_about_our_candidate,
            ca.strategic_quadrant, ca.action_type, ca.action_priority,
            ca.action_summary, ca.ai_reason
        FROM race_news_articles rn
        LEFT JOIN race_news_camp_analysis ca
            ON ca.race_news_id = rn.id AND ca.tenant_id = :tid
        WHERE rn.election_id = :eid
        {quadrant_clause}
        ORDER BY rn.published_at DESC NULLS LAST, rn.collected_at DESC
        LIMIT :limit
    """), params)).all()

    return [
        {
            "id": str(r.id),
            "title": r.title,
            "url": r.url,
            "source": r.source,
            "summary": r.summary,
            "platform": r.platform,
            "published_at": r.published_at.isoformat() if r.published_at else None,
            "collected_at": r.collected_at.isoformat() if r.collected_at else None,
            "ai_summary": r.ai_summary,
            "sentiment": r.sentiment,
            "sentiment_verified": r.sentiment_verified,
            "threat_level": r.ai_threat_level,
            # 캠프별 관점
            "candidate_id": str(r.candidate_id) if r.candidate_id else None,
            "is_about_our_candidate": r.is_about_our_candidate,
            "strategic_quadrant": r.strategic_quadrant,
            "action_type": r.action_type,
            "action_priority": r.action_priority,
            "action_summary": r.action_summary,
            "ai_reason": r.ai_reason,
        }
        for r in rows
    ]
