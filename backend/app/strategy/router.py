"""
ElectionPulse - Strategy API
4사분면 전략 분석 결과 + 액션 추천 endpoint.
모든 콘텐츠는 우리 후보 관점에서 분류됨:
- strength: 우리 후보 강점 (긍정 + 본인) → 확산
- weakness: 우리 후보 약점 (부정 + 본인) → 방어/해명
- opportunity: 공격 기회 (부정 + 경쟁자) → 활용
- threat: 경쟁 위협 (긍정 + 경쟁자) → 견제
"""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.common.election_access import get_election_tenant_ids

router = APIRouter()


QUADRANT_LABELS = {
    "strength": {"label": "우리 강점", "icon": "✨", "color": "blue", "action": "확산", "priority": 3},
    "weakness": {"label": "우리 위기", "icon": "🚨", "color": "red", "action": "방어", "priority": 1},
    "opportunity": {"label": "공격 기회", "icon": "🔥", "color": "orange", "action": "활용", "priority": 2},
    "threat": {"label": "경쟁 위협", "icon": "⚠️", "color": "amber", "action": "견제", "priority": 4},
    "neutral": {"label": "중립/참고", "icon": "📄", "color": "gray", "action": "관찰", "priority": 5},
}


async def _quadrant_items(db: AsyncSession, table: str, content_col: str,
                          election_id: UUID, all_tids: list, sval: str, limit: int = 10) -> list[dict]:
    """특정 사분면의 top N items."""
    # youtube_videos는 url 컬럼 없고 video_id로 만들어야 함
    if table == "youtube_videos":
        url_expr = "'https://www.youtube.com/watch?v=' || t.video_id"
    else:
        url_expr = "t.url"

    rows = (await db.execute(text(f"""
        SELECT t.id, t.title, {url_expr} as url, t.{content_col} as content, t.published_at, t.collected_at,
               t.sentiment, t.strategic_value, t.action_type, t.action_priority,
               t.action_summary, t.ai_summary, t.is_about_our_candidate,
               c.name as cand_name, c.is_our_candidate
        FROM {table} t
        LEFT JOIN candidates c ON t.candidate_id = c.id
        WHERE t.election_id = :eid
          AND t.tenant_id = ANY(:tids)
          AND t.strategic_value = :sval
        ORDER BY
          CASE t.action_priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          t.published_at DESC NULLS LAST,
          t.collected_at DESC
        LIMIT :lim
    """), {
        "eid": str(election_id),
        "tids": [str(t) for t in all_tids],
        "sval": sval,
        "lim": limit,
    })).all()

    return [
        {
            "id": str(r[0]),
            "title": r[1],
            "url": r[2],
            "content": (r[3] or "")[:200],
            "date": (r[4] or r[5]).strftime("%Y-%m-%d") if (r[4] or r[5]) else None,
            "collected_at": r[5].isoformat() if r[5] else None,
            "sentiment": r[6],
            "strategic_value": r[7],
            "action_type": r[8],
            "action_priority": r[9],
            "action_summary": r[10],
            "ai_summary": r[11],
            "is_about_our_candidate": r[12],
            "candidate": r[13],
            "media_table": table,
        }
        for r in rows
    ]


@router.get("/{election_id}/quadrant")
async def get_strategic_quadrant(
    election_id: UUID,
    user: CurrentUser,
    media: str = "all",  # all | news | community | youtube
    items_per_quadrant: int = 5,
    db: AsyncSession = Depends(get_db),
):
    """
    4사분면 전략 분석 결과.
    Returns: { strength, weakness, opportunity, threat, neutral } 각각 통계 + top items
    """
    all_tids = await get_election_tenant_ids(db, election_id)

    tables = []
    if media in ("all", "news"):
        tables.append(("news_articles", "summary"))
    if media in ("all", "community"):
        tables.append(("community_posts", "content_snippet"))
    if media in ("all", "youtube"):
        tables.append(("youtube_videos", "description_snippet"))

    quadrants = {}
    counts = {"strength": 0, "weakness": 0, "opportunity": 0, "threat": 0, "neutral": 0}

    for sval in ("strength", "weakness", "opportunity", "threat"):
        items = []
        for tbl, col in tables:
            sub = await _quadrant_items(db, tbl, col, election_id, all_tids, sval, items_per_quadrant)
            items.extend(sub)
        # 우선순위 정렬
        # 두 단계 stable sort: 시간 역순 → 우선순위
        items.sort(key=lambda x: x.get("collected_at") or "", reverse=True)
        items.sort(key=lambda x: {"high": 0, "medium": 1, "low": 2}.get(x.get("action_priority") or "low", 3))
        quadrants[sval] = {
            **QUADRANT_LABELS[sval],
            "items": items[:items_per_quadrant],
        }

    # 통계 — 모든 사분면 카운트
    for tbl, _col in tables:
        rows = (await db.execute(text(f"""
            SELECT strategic_value, COUNT(*) FROM {tbl}
            WHERE election_id = :eid AND tenant_id = ANY(:tids)
              AND strategic_value IS NOT NULL
            GROUP BY strategic_value
        """), {"eid": str(election_id), "tids": [str(t) for t in all_tids]})).all()
        for sv, cnt in rows:
            counts[sv] = counts.get(sv, 0) + cnt

    # 분석 진행 상태 (얼마나 많이 AI 분석됐는지)
    progress_total = 0
    progress_analyzed = 0
    for tbl, _col in tables:
        r = (await db.execute(text(f"""
            SELECT COUNT(*) total, COUNT(strategic_value) analyzed
            FROM {tbl} WHERE election_id = :eid AND tenant_id = ANY(:tids)
        """), {"eid": str(election_id), "tids": [str(t) for t in all_tids]})).first()
        progress_total += r[0] or 0
        progress_analyzed += r[1] or 0

    return {
        "election_id": str(election_id),
        "media": media,
        "counts": counts,
        "quadrants": quadrants,
        "analysis_progress": {
            "total": progress_total,
            "analyzed": progress_analyzed,
            "pct": round(progress_analyzed / progress_total * 100, 1) if progress_total else 0,
        },
    }


@router.post("/{election_id}/analyze")
async def trigger_strategic_analysis(
    election_id: UUID,
    user: CurrentUser,
    limit_per_type: int = 30,
    db: AsyncSession = Depends(get_db),
):
    """수동으로 전략 분석 트리거 (백그라운드 task)."""
    import asyncio
    from app.database import async_session_factory
    from app.analysis.media_analyzer import analyze_all_media

    tid = user["tenant_id"]

    async def _bg():
        async with async_session_factory() as bg_db:
            try:
                result = await analyze_all_media(bg_db, tid, str(election_id), limit_per_type=limit_per_type)
                import structlog
                structlog.get_logger().info("strategic_analysis_done", result=result)
            except Exception as e:
                import structlog
                structlog.get_logger().error("strategic_analysis_failed", error=str(e))

    asyncio.create_task(_bg())
    return {
        "message": "전략 분석이 백그라운드에서 시작되었습니다. 잠시 후 페이지를 새로고침하세요.",
        "limit_per_type": limit_per_type,
    }
