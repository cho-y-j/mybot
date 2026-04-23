"""최근 7일 뉴스 재분석 — 수정된 sentiment 프롬프트 적용.

새 프롬프트 규칙: sentiment는 기자 톤만, 모르면 neutral, strategic_value와 독립.
기존 DB의 잘못된 negative 쏠림 수정.

실행:
  docker exec ep_backend python3 -m backend.scripts.reanalyze_recent_news ELECTION_ID
  (컨테이너 내부 경로는 app/scripts/ 에 복사되어 있다는 전제)
"""
import asyncio
import sys
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from app import init_app  # noqa
from app.database import async_session_factory
from sqlalchemy import text
from app.analysis.media_analyzer import analyze_batch_strategic
from app.analysis.strategic_views import upsert_strategic_view_async

BATCH_SIZE = 10


async def run(election_id: str, days: int = 7, tenant_id: str | None = None):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    total_updated = 0
    total_failed = 0

    async with async_session_factory() as db:
        # 선거 + 후보 정보
        erow = (await db.execute(text(
            "SELECT id, election_type, region_sido, region_sigungu FROM elections WHERE id = cast(:eid as uuid)"
        ), {"eid": election_id})).first()
        if not erow:
            print(f"[ERR] election not found: {election_id}")
            return

        # 기준 캠프(our tenant) 명시 — 여러 캠프가 같은 선거를 공유할 때 첫 캠프가 아닌 지정한 tenant 기준으로 분석
        our_cand_id_row = (await db.execute(text(
            "SELECT our_candidate_id FROM tenant_elections WHERE tenant_id = cast(:tid as uuid) AND election_id = cast(:eid as uuid)"
        ), {"tid": tenant_id, "eid": election_id})).first() if tenant_id else None
        our_cand_id = str(our_cand_id_row.our_candidate_id) if our_cand_id_row and our_cand_id_row.our_candidate_id else None

        cands = (await db.execute(text("""
            SELECT c.id, c.name, c.homonym_filters
              FROM candidates c
             WHERE c.election_id = cast(:eid as uuid) AND c.enabled = true
             ORDER BY c.priority
        """), {"eid": election_id})).all()

        our_name = None
        rival_names = []
        all_hints = set()
        for c in cands:
            if our_cand_id and str(c.id) == our_cand_id:
                our_name = c.name
            else:
                rival_names.append(c.name)
            for h in (c.homonym_filters or []):
                if h:
                    all_hints.add(str(h)[:40])
        our_name = our_name or (cands[0].name if cands else "우리 후보")
        region = f"{erow.region_sido or ''} {erow.region_sigungu or ''}".strip()

        print(f"[CONFIG] election_id={election_id} election_type={erow.election_type} region={region}")
        print(f"[CONFIG] our={our_name} rivals={rival_names}")
        print(f"[CONFIG] homonym_hints={sorted(all_hints)}")
        print()

        # 대상 뉴스 로드
        news = (await db.execute(text("""
            SELECT n.id, n.title, n.summary, n.candidate_id, c.name AS cand_name
              FROM news_articles n
              JOIN candidates c ON c.id = n.candidate_id
             WHERE n.election_id = cast(:eid as uuid)
               AND n.collected_at >= :cutoff
             ORDER BY n.collected_at DESC
        """), {"eid": election_id, "cutoff": cutoff})).all()

    print(f"[SCOPE] {len(news)} articles (last {days}d) to reanalyze\n")

    # 배치 처리
    for batch_idx in range(0, len(news), BATCH_SIZE):
        batch = news[batch_idx:batch_idx + BATCH_SIZE]
        items = [
            {
                "id": str(n.id),
                "title": n.title or "",
                "description": (n.summary or n.title or "")[:500],
                "candidate_id": str(n.candidate_id) if n.candidate_id else "",
                "candidate_name": n.cand_name or "",
            }
            for n in batch
        ]

        try:
            results = await analyze_batch_strategic(
                items=items,
                our_candidate_name=our_name,
                rival_candidate_names=rival_names,
                election_type=erow.election_type or "",
                region=region,
                homonym_hints=sorted(all_hints),
            )
        except Exception as e:
            print(f"[BATCH {batch_idx}] AI error: {e}")
            total_failed += len(batch)
            continue

        if not results:
            print(f"[BATCH {batch_idx}] no results")
            total_failed += len(batch)
            continue

        # DB 반영
        res_by_id = {str(r.get("id", "")): r for r in results}
        async with async_session_factory() as db:
            batch_count = 0
            for n in batch:
                r = res_by_id.get(str(n.id))
                if not r:
                    continue
                try:
                    await db.execute(text("""
                        UPDATE news_articles SET
                            sentiment = :sent,
                            sentiment_score = :score,
                            is_relevant = :rel,
                            ai_summary = :summary,
                            ai_reason = :reason,
                            ai_threat_level = :threat,
                            ai_analyzed_at = now()
                        WHERE id = :nid
                    """), {
                        "nid": n.id,
                        "sent": r.get("sentiment"),
                        "score": r.get("sentiment_score") or 0.0,
                        "rel": bool(r.get("is_relevant", True)),
                        "summary": r.get("summary"),
                        "reason": r.get("reason"),
                        "threat": r.get("threat_level"),
                    })
                    # strategic view upsert — 첫 캠프(any_our 소유 tenant)로 기록
                    effective_tenant = tenant_id
                    if not effective_tenant:
                        tenant_row = (await db.execute(text(
                            "SELECT te.tenant_id FROM tenant_elections te "
                            "WHERE te.election_id = cast(:eid as uuid) ORDER BY te.created_at LIMIT 1"
                        ), {"eid": election_id})).first()
                        effective_tenant = str(tenant_row.tenant_id) if tenant_row else None
                    if effective_tenant and n.candidate_id:
                        await upsert_strategic_view_async(
                            db, "news",
                            source_id=n.id,
                            tenant_id=effective_tenant,
                            election_id=election_id,
                            candidate_id=n.candidate_id,
                            strategic_quadrant=r.get("strategic_value"),
                            strategic_value=r.get("strategic_value"),
                            action_type=r.get("action_type"),
                            action_priority=r.get("action_priority"),
                            action_summary=r.get("action_summary"),
                            is_about_our_candidate=r.get("is_about_our_candidate"),
                        )
                    batch_count += 1
                except Exception as e:
                    print(f"[BATCH {batch_idx}] update error id={n.id}: {e}")
                    total_failed += 1
            await db.commit()
            total_updated += batch_count

        print(f"[BATCH {batch_idx:>4}/{len(news)}] updated {batch_count}/{len(batch)} (running total={total_updated})")

    print(f"\n[DONE] updated={total_updated}  failed={total_failed}  total={len(news)}")


if __name__ == "__main__":
    eid = sys.argv[1] if len(sys.argv) > 1 else "e0eacdb9-d1e2-494c-860f-abd719dbd206"
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    tid = sys.argv[3] if len(sys.argv) > 3 else None
    asyncio.run(run(eid, days, tid))
