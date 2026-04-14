"""
Today's Action — 쉬운 모드 홈 화면용 우선순위 액션 추천.

전체 데이터에서 다음 순서로 "오늘 해야 할 일" 3~5개를 자동 추천:
  1. 위기: weakness 기사 다수 → 해명 콘텐츠 필요
  2. 경쟁 기회: opportunity 기사 → 공격 콘텐츠 필요
  3. 강점 확산: strength 기사 → SNS 콘텐츠
  4. 브리핑 미확인: 최근 브리핑 중 안 읽은 것
  5. 트렌드 키워드: 급상승 검색어 → 관련 콘텐츠
"""
from datetime import date, timedelta
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

import structlog
logger = structlog.get_logger()


async def get_today_actions(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
) -> list[dict]:
    """오늘 꼭 해야 할 일 3~5개 반환."""
    from app.elections.models import (
        NewsArticle, CommunityPost, Report, NewsStrategicView, Candidate,
    )
    from app.common.election_access import get_our_candidate_id, list_election_candidates

    today = date.today()
    since_24h = today - timedelta(days=1)
    since_3d = today - timedelta(days=3)

    actions: list[dict] = []
    tid = str(tenant_id)
    our_cand_id = await get_our_candidate_id(db, tid, election_id)
    candidates = await list_election_candidates(db, election_id, tenant_id=tid)
    our = next((c for c in candidates if c.is_our_candidate), None)

    # 1. 위기 감지 — 최근 3일 weakness strategic_view가 2건 이상
    try:
        weakness_rows = (await db.execute(text("""
            SELECT COUNT(*) as cnt,
                   array_agg(n.title ORDER BY n.published_at DESC NULLS LAST) FILTER (WHERE n.title IS NOT NULL) as titles
            FROM news_strategic_views sv
            JOIN news_articles n ON n.id = sv.news_id
            WHERE sv.tenant_id = cast(:tid as uuid)
              AND sv.election_id = cast(:eid as uuid)
              AND sv.strategic_quadrant = 'weakness'
              AND DATE(n.collected_at) >= :since
        """), {"tid": tid, "eid": election_id, "since": since_3d})).fetchone()

        if weakness_rows and weakness_rows.cnt and weakness_rows.cnt >= 2:
            titles = (weakness_rows.titles or [])[:2]
            actions.append({
                "priority": "high",
                "icon": "⚠️",
                "type": "crisis",
                "title": "위기 대응 필요",
                "summary": f"최근 3일간 부정 이슈 {weakness_rows.cnt}건 감지",
                "detail": " / ".join(t[:40] for t in titles) if titles else "",
                "action": "해명 콘텐츠 생성",
                "action_link": "/easy/content?type=defense&topic=" + (titles[0][:60] if titles else "부정 보도 대응"),
                "secondary": {"label": "자세히 보기", "link": "/easy/news?sentiment=negative"},
            })
    except Exception as e:
        logger.warning("today_crisis_error", error=str(e)[:200])

    # 2. 경쟁 기회 — opportunity 1건 이상 (최근 7일)
    try:
        opp_rows = (await db.execute(text("""
            SELECT n.title, n.ai_summary, c.name as candidate_name
            FROM news_strategic_views sv
            JOIN news_articles n ON n.id = sv.news_id
            LEFT JOIN candidates c ON c.id = sv.candidate_id
            WHERE sv.tenant_id = cast(:tid as uuid)
              AND sv.election_id = cast(:eid as uuid)
              AND sv.strategic_quadrant = 'opportunity'
              AND DATE(n.collected_at) >= :since
            ORDER BY n.published_at DESC NULLS LAST, n.collected_at DESC
            LIMIT 3
        """), {"tid": tid, "eid": election_id, "since": today - timedelta(days=7)})).fetchall()

        if opp_rows:
            top = opp_rows[0]
            actions.append({
                "priority": "medium",
                "icon": "💡",
                "type": "opportunity",
                "title": "경쟁 기회 포착",
                "summary": f"{top.candidate_name or '경쟁 후보'} 관련 이슈 감지",
                "detail": (top.ai_summary or top.title or "")[:100],
                "action": "관련 SNS 포스팅 만들기",
                "action_link": f"/easy/content?type=sns&topic={(top.title or '')[:60]}",
                "secondary": {"label": "전체 기회", "link": "/easy/news?tab=opportunity"},
            })
    except Exception as e:
        logger.warning("today_opportunity_error", error=str(e)[:200])

    # 3. 미확인 브리핑 — 최근 24시간 브리핑 중 아직 확인 안 한 것
    try:
        brief_row = (await db.execute(text("""
            SELECT id, report_type, title, created_at
            FROM reports
            WHERE tenant_id = cast(:tid as uuid)
              AND election_id = cast(:eid as uuid)
              AND report_type IN ('morning_brief', 'afternoon_brief', 'ai_morning_brief', 'ai_afternoon_brief', 'daily', 'ai_daily')
              AND DATE(created_at) >= :since
            ORDER BY created_at DESC LIMIT 1
        """), {"tid": tid, "eid": election_id, "since": since_24h})).fetchone()

        if brief_row:
            type_label = {
                "morning_brief": "오전 브리핑",
                "afternoon_brief": "오후 브리핑",
                "ai_morning_brief": "오전 브리핑",
                "ai_afternoon_brief": "오후 브리핑",
                "daily": "일일 종합 보고서",
                "ai_daily": "일일 종합 보고서",
            }.get(brief_row.report_type, "브리핑")

            actions.append({
                "priority": "medium",
                "icon": "📋",
                "type": "briefing",
                "title": f"{type_label} 확인",
                "summary": f"방금 생성된 {type_label}",
                "detail": brief_row.title or "AI가 정리한 오늘의 핵심",
                "action": "지금 읽기",
                "action_link": f"/easy/reports?report_id={brief_row.id}",
                "secondary": {"label": "전체 보고서", "link": "/easy/reports"},
            })
    except Exception as e:
        logger.warning("today_brief_error", error=str(e)[:200])

    # 4. 강점 확산 — 최근 strength 기사
    try:
        str_rows = (await db.execute(text("""
            SELECT n.title, n.ai_summary
            FROM news_strategic_views sv
            JOIN news_articles n ON n.id = sv.news_id
            WHERE sv.tenant_id = cast(:tid as uuid)
              AND sv.election_id = cast(:eid as uuid)
              AND sv.strategic_quadrant = 'strength'
              AND DATE(n.collected_at) >= :since
            ORDER BY n.published_at DESC NULLS LAST, n.collected_at DESC
            LIMIT 3
        """), {"tid": tid, "eid": election_id, "since": since_3d})).fetchall()

        if str_rows:
            top = str_rows[0]
            actions.append({
                "priority": "low",
                "icon": "✨",
                "type": "strength",
                "title": "강점 확산",
                "summary": f"{our.name if our else '우리 후보'}의 긍정 이슈 {len(str_rows)}건",
                "detail": (top.ai_summary or top.title or "")[:100],
                "action": "SNS로 확산",
                "action_link": f"/easy/content?type=sns&purpose=promote&topic={(top.title or '')[:60]}",
                "secondary": None,
            })
    except Exception as e:
        logger.warning("today_strength_error", error=str(e)[:200])

    # 5. 수집 현황 (액션 아닌 상태 요약)
    try:
        counts = (await db.execute(text("""
            SELECT
                (SELECT COUNT(*) FROM news_articles WHERE election_id = cast(:eid as uuid) AND DATE(collected_at) = CURRENT_DATE AND is_relevant = true) as news_today,
                (SELECT COUNT(*) FROM community_posts WHERE election_id = cast(:eid as uuid) AND DATE(collected_at) = CURRENT_DATE AND is_relevant = true) as comm_today,
                (SELECT COUNT(*) FROM youtube_videos WHERE election_id = cast(:eid as uuid) AND DATE(collected_at) = CURRENT_DATE AND is_relevant = true) as yt_today
        """), {"eid": election_id})).fetchone()

        summary = {
            "news_today": counts.news_today or 0,
            "comm_today": counts.comm_today or 0,
            "yt_today": counts.yt_today or 0,
        }
    except Exception:
        summary = {"news_today": 0, "comm_today": 0, "yt_today": 0}

    # 최대 4개 액션
    actions = actions[:4]

    return {
        "actions": actions,
        "summary": summary,
        "election": {
            "name": None,
            "d_day": None,
        },
        "our_candidate": our.name if our else None,
    }
