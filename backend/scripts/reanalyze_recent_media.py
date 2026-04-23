"""최근 N일 3매체(뉴스/커뮤니티/유튜브) 재분석 스크립트.

이전 reanalyze_recent_news.py 는 뉴스 전용이었음. 이 스크립트는 한 번 실행으로
  - news_articles
  - community_posts
  - youtube_videos
세 테이블을 모두 새 프롬프트로 재판정하고 sentiment/is_relevant/ai_summary/
ai_reason/ai_threat_level/strategic_quadrant 갱신 + strategic_views upsert.

사용:
  python -m scripts.reanalyze_recent_media <election_id> [days=7] [tenant_id]
  python -m scripts.reanalyze_recent_media ALL 7        # 모든 활성 선거
"""
from __future__ import annotations
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from uuid import UUID

from app import init_app  # noqa
from app.database import async_session_factory
from sqlalchemy import text

from app.analysis.media_analyzer import analyze_batch_strategic
from app.analysis.strategic_views import upsert_strategic_view_async

BATCH = 10

MEDIA_TABLES = {
    "news": {
        "table": "news_articles",
        "content_col": "summary",
    },
    "community": {
        "table": "community_posts",
        "content_col": "content_snippet",
    },
    "youtube": {
        "table": "youtube_videos",
        "content_col": "description_snippet",
    },
}


async def _load_candidates(db, election_id: str, tenant_id: str | None):
    erow = (await db.execute(text(
        "SELECT id, election_type, region_sido, region_sigungu FROM elections WHERE id = cast(:eid as uuid)"
    ), {"eid": election_id})).first()
    if not erow:
        return None, None, None, None, None

    our_id = None
    if tenant_id:
        r = (await db.execute(text(
            "SELECT our_candidate_id FROM tenant_elections WHERE tenant_id=cast(:tid as uuid) AND election_id=cast(:eid as uuid)"
        ), {"tid": tenant_id, "eid": election_id})).first()
        if r and r.our_candidate_id:
            our_id = str(r.our_candidate_id)

    cands = (await db.execute(text("""
        SELECT c.id, c.name, c.homonym_filters
          FROM candidates c
         WHERE c.election_id = cast(:eid as uuid) AND c.enabled = true
         ORDER BY c.priority
    """), {"eid": election_id})).all()

    our = None
    rivals = []
    hints = set()
    for c in cands:
        if our_id and str(c.id) == our_id:
            our = c.name
        else:
            rivals.append(c.name)
        for h in (c.homonym_filters or []):
            if h:
                hints.add(str(h)[:40])
    our = our or (cands[0].name if cands else "우리 후보")
    region = f"{erow.region_sido or ''} {erow.region_sigungu or ''}".strip()
    effective_tenant = tenant_id
    if not effective_tenant:
        r = (await db.execute(text(
            "SELECT tenant_id FROM tenant_elections WHERE election_id=cast(:eid as uuid) ORDER BY created_at LIMIT 1"
        ), {"eid": election_id})).first()
        effective_tenant = str(r.tenant_id) if r else None
    return erow, our, rivals, sorted(hints), effective_tenant


async def _reanalyze_media(election_id: str, days: int, tenant_id: str | None, media: str):
    cfg = MEDIA_TABLES[media]
    tbl = cfg["table"]
    content_col = cfg["content_col"]

    async with async_session_factory() as db:
        erow, our, rivals, hints, effective_tenant = await _load_candidates(db, election_id, tenant_id)
        if not erow:
            print(f"[{media}] election not found: {election_id}")
            return {"media": media, "updated": 0, "failed": 0, "total": 0}

        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        rows = (await db.execute(text(f"""
            SELECT x.id, x.title, x.{content_col} AS content, x.candidate_id, c.name AS cand_name
              FROM {tbl} x
              LEFT JOIN candidates c ON c.id = x.candidate_id
             WHERE x.election_id = cast(:eid as uuid)
               AND x.collected_at >= :cutoff
             ORDER BY x.collected_at DESC
        """), {"eid": election_id, "cutoff": cutoff})).all()

    print(f"[{media}] {len(rows)} rows to reanalyze (election={election_id[:8]}..., our={our})")

    updated = 0
    failed = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        items = [{
            "id": str(r.id),
            "title": r.title or "",
            "description": (r.content or r.title or "")[:500],
            "candidate_id": str(r.candidate_id) if r.candidate_id else "",
            "candidate_name": r.cand_name or "",
        } for r in batch]

        try:
            results = await analyze_batch_strategic(
                items=items,
                our_candidate_name=our,
                rival_candidate_names=rivals,
                election_type=erow.election_type or "",
                region=f"{erow.region_sido or ''} {erow.region_sigungu or ''}".strip(),
                homonym_hints=hints,
            )
        except Exception as e:
            print(f"[{media}] batch {i} AI error: {e}")
            failed += len(batch)
            continue

        if not results:
            failed += len(batch)
            continue

        res_by_id = {str(r.get("id", "")): r for r in results}
        async with async_session_factory() as db:
            batch_updated = 0
            for row in batch:
                r = res_by_id.get(str(row.id))
                if not r:
                    continue
                try:
                    await db.execute(text(f"""
                        UPDATE {tbl} SET
                            sentiment = :sent,
                            sentiment_score = :score,
                            is_relevant = :rel,
                            ai_summary = :summary,
                            ai_reason = :reason,
                            ai_threat_level = :threat,
                            strategic_quadrant = :quad,
                            ai_analyzed_at = now()
                        WHERE id = :rid
                    """), {
                        "rid": row.id,
                        "sent": r.get("sentiment"),
                        "score": r.get("sentiment_score") or 0.0,
                        "rel": bool(r.get("is_relevant", True)),
                        "summary": r.get("summary"),
                        "reason": r.get("reason"),
                        "threat": r.get("threat_level"),
                        "quad": r.get("strategic_value") or r.get("strategic_quadrant"),
                    })
                    if effective_tenant and row.candidate_id:
                        await upsert_strategic_view_async(
                            db, media,
                            source_id=row.id,
                            tenant_id=effective_tenant,
                            election_id=election_id,
                            candidate_id=row.candidate_id,
                            strategic_quadrant=r.get("strategic_value") or r.get("strategic_quadrant"),
                            strategic_value=r.get("strategic_value"),
                            action_type=r.get("action_type"),
                            action_priority=r.get("action_priority"),
                            action_summary=r.get("action_summary"),
                            is_about_our_candidate=r.get("is_about_our_candidate"),
                        )
                    batch_updated += 1
                except Exception as e:
                    print(f"[{media}] update error id={row.id}: {e}")
                    failed += 1
            await db.commit()
            updated += batch_updated

        print(f"[{media}] batch {i:>4}/{len(rows)} updated {batch_updated}/{len(batch)} (total={updated})")

    print(f"[{media}][DONE] updated={updated} failed={failed} total={len(rows)}")
    return {"media": media, "updated": updated, "failed": failed, "total": len(rows)}


async def run_election(election_id: str, days: int, tenant_id: str | None = None):
    for media in ("news", "community", "youtube"):
        await _reanalyze_media(election_id, days, tenant_id, media)


async def run_all(days: int):
    """활성 선거 전체 대상. 각 선거의 대표 tenant 자동."""
    async with async_session_factory() as db:
        erows = (await db.execute(text(
            "SELECT id FROM elections WHERE is_active = true"
        ))).all()
    for erow in erows:
        eid = str(erow.id)
        print(f"\n========== election {eid} ==========")
        await run_election(eid, days, None)


if __name__ == "__main__":
    eid = sys.argv[1] if len(sys.argv) > 1 else "ALL"
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    tid = sys.argv[3] if len(sys.argv) > 3 else None
    if eid.upper() == "ALL":
        asyncio.run(run_all(days))
    else:
        asyncio.run(run_election(eid, days, tid))
