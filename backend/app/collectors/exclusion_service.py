"""
동명이인 자동 차단 서비스 (excluded_identifiers 테이블 래퍼).

전략:
- channel_name: YouTube 검색 결과 중 채널명이 등록된 블랙리스트에 있으면 스킵
- video_id: 언론사/공용 채널의 특정 영상 1건만 차단
- source_url / community_url: 뉴스/커뮤니티 글 1건만 차단
"""
from __future__ import annotations

import structlog
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


async def load_exclusions(
    db: AsyncSession,
    election_id: str,
    identifier_type: str | None = None,
) -> dict[str, set[str]]:
    """선거의 모든 차단 목록 로드. 반환: {type: {value1, value2, ...}}"""
    q = "SELECT identifier_type, value FROM excluded_identifiers WHERE election_id = :eid"
    params: dict = {"eid": election_id}
    if identifier_type:
        q += " AND identifier_type = :itype"
        params["itype"] = identifier_type
    rows = (await db.execute(sa_text(q), params)).fetchall()
    result: dict[str, set[str]] = {}
    for r in rows:
        result.setdefault(r[0], set()).add(r[1])
    return result


def load_exclusions_sync(session, election_id: str) -> dict[str, set[str]]:
    """Celery sync 버전."""
    rows = session.execute(
        sa_text("SELECT identifier_type, value FROM excluded_identifiers WHERE election_id = :eid"),
        {"eid": election_id},
    ).fetchall()
    result: dict[str, set[str]] = {}
    for r in rows:
        result.setdefault(r[0], set()).add(r[1])
    return result


async def record_exclusion(
    db: AsyncSession,
    *,
    election_id: str,
    candidate_id: str | None,
    tenant_id: str | None,
    identifier_type: str,
    value: str,
    reason: str = "",
    source: str = "ai",
) -> None:
    """차단 등록 (중복은 match_count 증가)."""
    if identifier_type not in ("channel_name", "video_id", "news_url", "community_url"):
        return
    if not value or len(value) > 500:
        return
    await db.execute(sa_text("""
        INSERT INTO excluded_identifiers
            (election_id, candidate_id, tenant_id, identifier_type, value, reason, source)
        VALUES
            (:eid, :cid, :tid, :itype, :val, :reason, :source)
        ON CONFLICT (election_id, identifier_type, value) DO UPDATE SET
            match_count = excluded_identifiers.match_count + 1,
            updated_at = NOW(),
            reason = COALESCE(EXCLUDED.reason, excluded_identifiers.reason)
    """), {
        "eid": election_id, "cid": candidate_id, "tid": tenant_id,
        "itype": identifier_type, "val": value[:500], "reason": reason[:500] if reason else None,
        "source": source,
    })


def record_exclusion_sync(
    session, *, election_id: str, candidate_id: str | None, tenant_id: str | None,
    identifier_type: str, value: str, reason: str = "", source: str = "ai",
) -> None:
    if identifier_type not in ("channel_name", "video_id", "news_url", "community_url"):
        return
    if not value or len(value) > 500:
        return
    session.execute(sa_text("""
        INSERT INTO excluded_identifiers
            (election_id, candidate_id, tenant_id, identifier_type, value, reason, source)
        VALUES
            (:eid, :cid, :tid, :itype, :val, :reason, :source)
        ON CONFLICT (election_id, identifier_type, value) DO UPDATE SET
            match_count = excluded_identifiers.match_count + 1,
            updated_at = NOW(),
            reason = COALESCE(EXCLUDED.reason, excluded_identifiers.reason)
    """), {
        "eid": election_id, "cid": candidate_id, "tid": tenant_id,
        "itype": identifier_type, "val": value[:500], "reason": reason[:500] if reason else None,
        "source": source,
    })


def filter_youtube_videos(videos: list[dict], exclusions: dict[str, set[str]]) -> tuple[list[dict], int]:
    """
    YouTube 검색 결과에서 차단 대상 제거.
    반환: (통과 영상 리스트, 제외된 개수)
    """
    channel_blocked = exclusions.get("channel_name", set())
    video_blocked = exclusions.get("video_id", set())
    if not channel_blocked and not video_blocked:
        return videos, 0

    kept = []
    removed = 0
    for v in videos:
        ch = v.get("channel", "")
        vid = v.get("video_id", "")
        if ch and ch in channel_blocked:
            removed += 1
            continue
        if vid and vid in video_blocked:
            removed += 1
            continue
        kept.append(v)
    return kept, removed


def should_skip_url(url: str, exclusions: dict[str, set[str]], platform: str = "news") -> bool:
    """뉴스/커뮤니티 URL이 차단 목록에 있는지."""
    key = "news_url" if platform == "news" else "community_url"
    blocked = exclusions.get(key, set())
    return bool(url and url in blocked)


async def apply_ai_exclusions(
    db: AsyncSession,
    *,
    election_id: str,
    tenant_id: str | None,
    items: list[dict],
) -> int:
    """
    AI 스크리닝 결과를 순회하며 is_relevant=false + block_type 별로 excluded_identifiers 에 등록.
    반환: 등록 건수.
    """
    cnt = 0
    for item in items:
        if item.get("is_relevant"):
            continue
        btype = item.get("block_type") or "none"
        if btype == "none":
            continue
        reason = (item.get("homonym_detected") or item.get("ai_reason") or "")[:300]
        cid = item.get("candidate_id")

        if btype == "channel_block":
            ch = item.get("channel") or ""
            if ch:
                await record_exclusion(db, election_id=election_id, candidate_id=cid, tenant_id=tenant_id,
                                       identifier_type="channel_name", value=ch, reason=reason)
                cnt += 1
        elif btype == "source_video":
            vid = item.get("video_id") or item.get("id") or ""
            if vid:
                await record_exclusion(db, election_id=election_id, candidate_id=cid, tenant_id=tenant_id,
                                       identifier_type="video_id", value=vid, reason=reason)
                cnt += 1
        elif btype == "source_url":
            # news or community 판별 — 플랫폼 정보가 없으면 news_url 로 기록
            url = item.get("url") or ""
            if url:
                ptype = item.get("_platform_hint") or "news"
                itype = "news_url" if ptype == "news" else "community_url"
                await record_exclusion(db, election_id=election_id, candidate_id=cid, tenant_id=tenant_id,
                                       identifier_type=itype, value=url, reason=reason)
                cnt += 1
    if cnt > 0:
        logger.info("ai_exclusions_recorded", count=cnt, election_id=election_id)
    return cnt


def apply_ai_exclusions_sync(
    session, *, election_id: str, tenant_id: str | None, items: list[dict],
) -> int:
    cnt = 0
    for item in items:
        if item.get("is_relevant"):
            continue
        btype = item.get("block_type") or "none"
        if btype == "none":
            continue
        reason = (item.get("homonym_detected") or item.get("ai_reason") or "")[:300]
        cid = item.get("candidate_id")

        if btype == "channel_block":
            ch = item.get("channel") or ""
            if ch:
                record_exclusion_sync(session, election_id=election_id, candidate_id=cid,
                                      tenant_id=tenant_id, identifier_type="channel_name",
                                      value=ch, reason=reason)
                cnt += 1
        elif btype == "source_video":
            vid = item.get("video_id") or item.get("id") or ""
            if vid:
                record_exclusion_sync(session, election_id=election_id, candidate_id=cid,
                                      tenant_id=tenant_id, identifier_type="video_id",
                                      value=vid, reason=reason)
                cnt += 1
        elif btype == "source_url":
            url = item.get("url") or ""
            if url:
                ptype = item.get("_platform_hint") or "news"
                itype = "news_url" if ptype == "news" else "community_url"
                record_exclusion_sync(session, election_id=election_id, candidate_id=cid,
                                      tenant_id=tenant_id, identifier_type=itype,
                                      value=url, reason=reason)
                cnt += 1
    if cnt > 0:
        logger.info("ai_exclusions_recorded_sync", count=cnt, election_id=election_id)
    return cnt
