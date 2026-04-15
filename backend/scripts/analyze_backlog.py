"""
미분석 데이터(ai_analyzed_at IS NULL) 강제 분석.
실행: docker exec ep_backend python -m scripts.analyze_backlog
"""
import asyncio
import sys
sys.path.insert(0, "/app")

from sqlalchemy import text
from app.database import async_session_factory
from app.analysis.media_analyzer import _analyze_table_strategic

TABLES = [
    ("news_articles", "summary"),
    ("youtube_videos", "description_snippet"),
    ("community_posts", "content_snippet"),
]


async def run_for_pair(tenant_id: str, election_id: str):
    for table, col in TABLES:
        total = 0
        for i in range(30):
            async with async_session_factory() as db:
                try:
                    r = await _analyze_table_strategic(
                        db, tenant_id, election_id,
                        table=table, content_col=col, limit=30, batch_size=8,
                    )
                    await db.commit()
                except Exception as e:
                    print(f"  {table} iter {i+1} FAIL: {str(e)[:200]}")
                    break
            a = r.get("analyzed", 0)
            irr = r.get("irrelevant", 0)
            total += a
            print(f"  {table} iter {i+1}: analyzed={a} irrelevant={irr}")
            if a == 0:
                break
        print(f"  ===> {table} total={total}")


async def main():
    async with async_session_factory() as db:
        rows = (await db.execute(text("""
            SELECT DISTINCT te.tenant_id, te.election_id
            FROM tenant_elections te
            WHERE te.our_candidate_id IS NOT NULL
        """))).all()

    for tid, eid in rows:
        print(f"\n=== tenant={str(tid)[:8]} election={str(eid)[:8]} ===")
        await run_for_pair(str(tid), str(eid))


if __name__ == "__main__":
    asyncio.run(main())
