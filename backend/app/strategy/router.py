"""
ElectionPulse - Strategy API
4사분면 전략 분석 결과 + 액션 추천 endpoint.
모든 콘텐츠는 우리 후보 관점에서 분류됨:
- strength: 우리 후보 강점 (긍정 + 본인) → 확산
- weakness: 우리 후보 약점 (부정 + 본인) → 방어/해명
- opportunity: 경쟁자 리스크 (부정 + 경쟁자) → 활용/공격 콘텐츠
- threat: 경쟁자 위협 (긍정 + 경쟁자) → 견제
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
    "opportunity": {"label": "경쟁자 리스크", "icon": "🔥", "color": "orange", "action": "활용", "priority": 2},
    "threat": {"label": "경쟁자 위협", "icon": "⚠️", "color": "amber", "action": "견제", "priority": 4},
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
            "is_our_candidate_original": r[14],  # 원본 tenant 기준
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
    로그인 캠프의 우리 후보 기준으로 동적 관점 전환.
    같은 선거를 공유하는 캠프마다 우리/경쟁이 반대이므로 API에서 뒤집음.
    """
    tid = user["tenant_id"]
    all_tids = await get_election_tenant_ids(db, election_id)

    # 핵심: 로그인 캠프의 우리 후보 ID
    from app.common.election_access import get_our_candidate_id
    our_cand_id = await get_our_candidate_id(db, tid, election_id)

    # 우리 후보 이름도 가져오기 (매칭용)
    our_cand_name = None
    if our_cand_id:
        r = (await db.execute(text("SELECT name FROM candidates WHERE id = :cid"), {"cid": our_cand_id})).scalar()
        our_cand_name = r

    tables = []
    if media in ("all", "news"):
        tables.append(("news_articles", "summary"))
    if media in ("all", "community"):
        tables.append(("community_posts", "content_snippet"))
    if media in ("all", "youtube"):
        tables.append(("youtube_videos", "description_snippet"))

    # 뒤집기 맵: 원본 → 로그인 캠프 관점
    FLIP = {
        "opportunity": "weakness",   # 경쟁자 리스크 → 우리 위기
        "weakness": "opportunity",   # 우리 위기 → 경쟁자 리스크
        "threat": "strength",        # 경쟁자 위협 → 우리 강점
        "strength": "threat",        # 우리 강점 → 경쟁자 위협
    }

    def _flip_item(item: dict) -> dict:
        """로그인 캠프 관점으로 item 뒤집기.

        원본 분석이 '다른 캠프' 기준이면:
        - 원본에서 우리 후보(is_about_our_candidate=True) → 현재 캠프에서는 경쟁자
        - 원본에서 경쟁자(is_about_our_candidate=False) → 현재 캠프에서는 우리 후보일 수 있음

        판단 기준: item의 candidate 이름이 로그인 캠프의 우리 후보 이름과 같은지.
        """
        if not our_cand_name:
            return item  # 우리 후보 미설정이면 원본 그대로

        cand_name = item.get("candidate") or ""
        is_about_ours_original = item.get("is_about_our_candidate", False)

        # 이 콘텐츠가 우리 후보에 관한 건지 (현재 로그인 캠프 기준)
        is_about_ours_now = (cand_name == our_cand_name)

        if is_about_ours_now == is_about_ours_original:
            # 관점 일치 — 뒤집을 필요 없음
            return item

        # 관점 불일치 — 뒤집기
        orig_sval = item.get("strategic_value", "")
        flipped_sval = FLIP.get(orig_sval, orig_sval)

        return {
            **item,
            "strategic_value": flipped_sval,
            "is_about_our_candidate": is_about_ours_now,
        }

    # 모든 사분면 items 가져온 후 뒤집기 적용
    all_items = []
    for sval in ("strength", "weakness", "opportunity", "threat"):
        for tbl, col in tables:
            sub = await _quadrant_items(db, tbl, col, election_id, all_tids, sval, items_per_quadrant * 3)
            all_items.extend(sub)

    # 로그인 캠프 관점으로 뒤집기
    flipped = [_flip_item(it) for it in all_items]

    # 뒤집은 후 사분면별 재분류
    quadrants = {}
    counts = {"strength": 0, "weakness": 0, "opportunity": 0, "threat": 0, "neutral": 0}

    for sval in ("strength", "weakness", "opportunity", "threat"):
        items = [it for it in flipped if it.get("strategic_value") == sval]
        items.sort(key=lambda x: x.get("collected_at") or "", reverse=True)
        items.sort(key=lambda x: {"high": 0, "medium": 1, "low": 2}.get(x.get("action_priority") or "low", 3))
        quadrants[sval] = {
            **QUADRANT_LABELS[sval],
            "items": items[:items_per_quadrant],
        }
        counts[sval] = len(items)

    # 미분류 items도 통계에 반영 (DB 전체 카운트 → 뒤집기 적용)
    for tbl, _col in tables:
        rows = (await db.execute(text(f"""
            SELECT t.strategic_value, t.is_about_our_candidate, c.name as cand_name, COUNT(*)
            FROM {tbl} t
            LEFT JOIN candidates c ON t.candidate_id = c.id
            WHERE t.election_id = :eid AND t.tenant_id = ANY(:tids)
              AND t.strategic_value IS NOT NULL
            GROUP BY t.strategic_value, t.is_about_our_candidate, c.name
        """), {"eid": str(election_id), "tids": [str(t) for t in all_tids]})).all()

    # counts는 이미 flipped items 기준으로 계산됨 (위에서)

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
