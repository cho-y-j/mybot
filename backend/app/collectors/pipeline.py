"""3매체(뉴스/커뮤니티/유튜브) 수집 공통 파이프라인.

설계 원칙 (feedback_media_pipeline_unified):
- 매체별 분기는 어댑터 레벨(raw 데이터 포맷)에서만.
- AI 스크리닝 → 저장 → 임베딩 → strategic_views 는 이 파일 한 곳.
- 폴백: AI 스크리닝 실패 시 전체 통과 금지. is_relevant=NULL(보류) 저장으로
  대시보드 노출 차단 + 다음 배치 분석에서 확정.

tasks.py (sync, Celery) 와 instant.py (async, FastAPI) 둘 다 같은 로직을 써야
하므로 sync / async 버전 각각 제공.
"""
from __future__ import annotations
from typing import Any
from uuid import UUID
import structlog

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.elections.models import NewsArticle, CommunityPost, YouTubeVideo
from app.analysis.strategic_views import (
    upsert_strategic_view_sync,
    upsert_strategic_view_async,
)

logger = structlog.get_logger()


# ───────── 매체별 매핑 ─────────
# 각 매체의 ORM 모델 / URL unique constraint / 컬럼 집합.
MEDIA_CONFIG = {
    "news": {
        "model": NewsArticle,
        "constraint": "uq_news_url_per_election",
        "unique_col": "url",
    },
    "community": {
        "model": CommunityPost,
        "constraint": "uq_community_url_per_election",
        "unique_col": "url",
    },
    "youtube": {
        "model": YouTubeVideo,
        "constraint": "uq_youtube_per_election",
        "unique_col": "video_id",
    },
}


def _row_from_item(media_type: str, item: dict, tenant_id: str, election_id: str) -> dict:
    """screened item → ORM 컬럼 dict. 매체별 필드 매핑."""
    ai_ok = bool(item.get("ai_screened", False))

    # 공통 AI 결과 필드 (폴백 시 None — is_relevant는 NULL로 보류)
    common = {
        "tenant_id": tenant_id,
        "election_id": election_id,
        "candidate_id": UUID(item["candidate_id"]) if item.get("candidate_id") else None,
        # AI 스크리닝 통과 → True, 미통과(폴백) → None (보류). False는 호출자가 이미 걸러냄.
        "is_relevant": True if ai_ok else None,
        "sentiment": item.get("sentiment") if ai_ok else None,
        "sentiment_score": item.get("sentiment_score") if ai_ok else None,
        "ai_summary": item.get("ai_summary") if ai_ok else None,
        "ai_reason": item.get("ai_reason") if ai_ok else None,
        "ai_threat_level": item.get("threat_level") if ai_ok else None,
    }

    if media_type == "news":
        return {
            **common,
            "title": item.get("title", ""),
            "url": item["url"],
            "source": item.get("source", ""),
            "summary": (item.get("description") or item.get("content") or "")[:300],
            "platform": item.get("platform", "naver"),
            "published_at": item.get("published_at"),
        }
    if media_type == "community":
        return {
            **common,
            "title": item.get("title", ""),
            "url": item["url"],
            "source": item.get("source", ""),
            "content_snippet": (item.get("content") or item.get("description") or "")[:2000],
            "platform": item.get("platform", "naver_blog"),
            "published_at": item.get("published_at"),
            "issue_category": item.get("issue_category"),
        }
    if media_type == "youtube":
        return {
            **common,
            "video_id": item.get("video_id") or item.get("url", "").split("=")[-1],
            "title": item.get("title", ""),
            "channel": item.get("channel") or item.get("channel_name") or item.get("source", ""),
            "description_snippet": (item.get("description") or item.get("content") or "")[:2000],
            "published_at": item.get("published_at"),
            "views": item.get("views") or 0,
        }
    raise ValueError(f"unknown media_type: {media_type}")


# ───────── Sync 버전 (Celery tasks.py 용) ─────────

def persist_screened_sync(
    session,
    media_type: str,
    screened: list[dict],
    tenant_id: str,
    election_id: str,
) -> dict:
    """Celery sync session에서 screened items 를 매체 테이블에 upsert.

    Returns: {"saved": int, "pending": int, "strategic_written": int}
    """
    if media_type not in MEDIA_CONFIG:
        raise ValueError(f"unknown media_type: {media_type}")

    cfg = MEDIA_CONFIG[media_type]
    model = cfg["model"]
    constraint = cfg["constraint"]

    saved = 0
    pending = 0
    strategic_written = 0

    for item in screened:
        ai_ok = bool(item.get("ai_screened", False))
        row = _row_from_item(media_type, item, tenant_id, election_id)

        # ON CONFLICT: URL 중복 시 published_at 만 업데이트 (보수적)
        # pending(is_relevant=NULL)이 나중에 AI 분석으로 True/False 확정되게 둠.
        stmt = pg_insert(model).values(**row).on_conflict_do_update(
            constraint=constraint,
            set_={"published_at": pg_insert(model).excluded.published_at},
        ).returning(model.id)

        res = session.execute(stmt)
        row_id = res.scalar()
        if row_id is None:
            continue
        if ai_ok:
            saved += 1
        else:
            pending += 1

        # strategic_views 는 AI 판정 성공한 것만
        if ai_ok and item.get("candidate_id"):
            try:
                upsert_strategic_view_sync(
                    session, media_type,
                    source_id=row_id,
                    tenant_id=tenant_id,
                    election_id=election_id,
                    candidate_id=UUID(item["candidate_id"]),
                    strategic_quadrant=item.get("strategic_quadrant") or item.get("strategic_value"),
                    strategic_value=item.get("strategic_value") or item.get("strategic_quadrant"),
                    action_type=item.get("action_type"),
                    action_priority=item.get("action_priority"),
                    action_summary=item.get("action_summary"),
                    is_about_our_candidate=item.get("is_about_our_candidate"),
                )
                strategic_written += 1
            except Exception as e:
                logger.warning("pipeline_strategic_failed",
                               media=media_type, error=str(e)[:200])

    return {"saved": saved, "pending": pending, "strategic_written": strategic_written}


# ───────── Async 버전 (instant.py 용) ─────────

async def persist_screened_async(
    db,
    media_type: str,
    screened: list[dict],
    tenant_id: str,
    election_id: str,
) -> dict:
    """FastAPI async session에서 screened items 를 매체 테이블에 upsert."""
    if media_type not in MEDIA_CONFIG:
        raise ValueError(f"unknown media_type: {media_type}")

    cfg = MEDIA_CONFIG[media_type]
    model = cfg["model"]
    constraint = cfg["constraint"]

    saved = 0
    pending = 0
    strategic_written = 0

    for item in screened:
        ai_ok = bool(item.get("ai_screened", False))
        row = _row_from_item(media_type, item, tenant_id, election_id)

        stmt = pg_insert(model).values(**row).on_conflict_do_update(
            constraint=constraint,
            set_={"published_at": pg_insert(model).excluded.published_at},
        ).returning(model.id)

        res = await db.execute(stmt)
        row_id = res.scalar()
        if row_id is None:
            continue
        if ai_ok:
            saved += 1
        else:
            pending += 1

        if ai_ok and item.get("candidate_id"):
            try:
                await upsert_strategic_view_async(
                    db, media_type,
                    source_id=row_id,
                    tenant_id=tenant_id,
                    election_id=election_id,
                    candidate_id=UUID(item["candidate_id"]),
                    strategic_quadrant=item.get("strategic_quadrant") or item.get("strategic_value"),
                    strategic_value=item.get("strategic_value") or item.get("strategic_quadrant"),
                    action_type=item.get("action_type"),
                    action_priority=item.get("action_priority"),
                    action_summary=item.get("action_summary"),
                    is_about_our_candidate=item.get("is_about_our_candidate"),
                )
                strategic_written += 1
            except Exception as e:
                logger.warning("pipeline_strategic_failed",
                               media=media_type, error=str(e)[:200])

    return {"saved": saved, "pending": pending, "strategic_written": strategic_written}


# ───────── 스크리닝 + 저장 통합 래퍼 (선택적으로 사용) ─────────

async def screen_and_persist_async(
    db,
    media_type: str,
    raw_items: list[dict],
    our_candidate_name: str,
    rival_candidate_names: list[str],
    election_type: str,
    region: str,
    homonym_hints: list[str],
    tenant_id: str,
    election_id: str,
) -> dict:
    """raw_items → AI 스크리닝 → persist → 결과 리턴.

    AI 스크리닝 실패 시 각 item에 ai_screened=False 표시하고 그대로 persist.
    persist 단계에서 is_relevant=NULL(보류)로 저장되어 대시보드 노출 차단.
    """
    from app.collectors.ai_screening import screen_collected_items

    filtered_out = 0
    try:
        screened = await screen_collected_items(
            items=raw_items,
            our_candidate_name=our_candidate_name,
            rival_candidate_names=rival_candidate_names,
            election_type=election_type,
            region=region,
            homonym_hints=homonym_hints,
            tenant_id=tenant_id,
            db=db,
        )
        filtered_out = len(raw_items) - len(screened)
    except Exception as e:
        logger.error("screen_failed_fallback_pending",
                     media=media_type, error=str(e)[:200])
        # 실패 시 raw_items 그대로 — ai_screened=False 가 이미 찍혀 있지 않으므로 명시
        screened = []
        for it in raw_items:
            it["ai_screened"] = False
            it["is_relevant"] = None  # 보류
            screened.append(it)

    result = await persist_screened_async(db, media_type, screened, tenant_id, election_id)
    result["filtered"] = filtered_out
    result["input"] = len(raw_items)
    return result
