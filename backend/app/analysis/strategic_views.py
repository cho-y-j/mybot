"""
전략 뷰 upsert 헬퍼 — 2026-04-14 election-shared 리팩터링.

원본 데이터(news/community/youtube)는 election 단위로 공유되고,
4사분면 / 액션 분석은 캠프별로 *_strategic_views 테이블에 저장한다.

sync(SQLAlchemy Session) / async(AsyncSession) 두 진입점 모두 제공.
"""
from datetime import datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.elections.models import (
    NewsStrategicView, CommunityStrategicView, YouTubeStrategicView,
)

# 매체 → (ORM 모델, FK 컬럼명) 매핑
_MEDIA_MAP = {
    "news": (NewsStrategicView, "news_id"),
    "community": (CommunityStrategicView, "post_id"),
    "youtube": (YouTubeStrategicView, "video_id"),
}


def _build_values(
    media: str,
    *,
    source_id: Any,
    tenant_id: Any,
    election_id: Any,
    candidate_id: Any | None,
    strategic_quadrant: str | None,
    strategic_value: str | None = None,  # news only
    action_type: str | None,
    action_priority: str | None,
    action_summary: str | None,
    is_about_our_candidate: bool | None,
):
    Model, fk = _MEDIA_MAP[media]
    vals = {
        fk: source_id,
        "tenant_id": tenant_id,
        "election_id": election_id,
        "candidate_id": candidate_id,
        "strategic_quadrant": strategic_quadrant,
        "action_type": action_type,
        "action_priority": action_priority,
        "action_summary": (action_summary or "")[:300] if action_summary else None,
        "is_about_our_candidate": is_about_our_candidate,
    }
    if media == "news":
        vals["strategic_value"] = strategic_value or strategic_quadrant
    return vals, Model, fk


_CONSTRAINT_NAMES = {
    "news": "uq_news_sv_per_tenant",
    "community": "uq_comm_sv_per_tenant",
    "youtube": "uq_yt_sv_per_tenant",
}


def _build_upsert_stmt(media: str, **kwargs):
    vals, Model, fk = _build_values(media, **kwargs)
    stmt = pg_insert(Model).values(**vals)
    update_cols = {k: stmt.excluded[k] for k in vals if k not in (fk, "tenant_id")}
    update_cols["updated_at"] = datetime.utcnow()
    return stmt.on_conflict_do_update(
        constraint=_CONSTRAINT_NAMES[media],
        set_=update_cols,
    )


def upsert_strategic_view_sync(session, media: str, **kwargs):
    """SQLAlchemy sync session용."""
    session.execute(_build_upsert_stmt(media, **kwargs))


async def upsert_strategic_view_async(db, media: str, **kwargs):
    """AsyncSession용."""
    await db.execute(_build_upsert_stmt(media, **kwargs))
