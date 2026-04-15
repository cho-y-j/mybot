"""
기존 캠프(5개)에 homepage User + autofill 일괄 적용.

서버에서 실행:
  docker exec ep_backend python -m scripts.backfill_homepage
"""
import asyncio
import sys
sys.path.insert(0, "/app")

from sqlalchemy import text
from app.database import async_session_factory
from app.elections.bootstrap import bootstrap_campaign
from app.elections.homepage_autofill import auto_fill_homepage


async def main():
    async with async_session_factory() as db:
        rows = (await db.execute(text("""
            SELECT DISTINCT te.tenant_id, te.election_id
            FROM tenant_elections te
            WHERE te.our_candidate_id IS NOT NULL
        """))).all()
        print(f"발견된 캠프: {len(rows)}개")

        for tid, eid in rows:
            tid_s, eid_s = str(tid), str(eid)
            print(f"\n[{tid_s[:8]}] election={eid_s[:8]} 처리 중…")

            # homepage user 존재 여부
            hp = (await db.execute(text(
                "SELECT id, code FROM homepage.users WHERE tenant_id = cast(:tid as uuid)"
            ), {"tid": tid_s})).first()

            if hp:
                user_id, code = hp[0], hp[1]
                print(f"  홈페이지 이미 존재 (code={code}) — autofill만 실행")
                try:
                    r = await auto_fill_homepage(db, tid_s, eid_s, user_id)
                    await db.commit()
                    print(f"  ✅ autofill: {r}")
                except Exception as e:
                    await db.rollback()
                    print(f"  ❌ autofill 실패: {e}")
            else:
                print("  homepage user 없음 — bootstrap 실행")
                try:
                    r = await bootstrap_campaign(db, tid_s, eid_s, plan="full")
                    await db.commit()
                    print(f"  ✅ bootstrap: homepage={r.get('homepage')} fill={r.get('homepage_autofill')}")
                except Exception as e:
                    await db.rollback()
                    print(f"  ❌ bootstrap 실패: {e}")


if __name__ == "__main__":
    asyncio.run(main())
