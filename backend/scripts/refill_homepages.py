"""5개 캠프 homepage 데이터 강제 재수집.

- candidate_profiles 가 비어있어 profiles/pledges 들어갈 데이터가 없음
- _naver_autofetch (WebSearch로 공식 공약/유튜브/블로그 수집) 강제 실행
- 기존 0건인 항목만 채움 (덮어쓰기 X)
"""
import asyncio
import sys
sys.path.insert(0, "/app")

from sqlalchemy import text
from app.database import async_session_factory
from app.elections.homepage_autofill import auto_fill_homepage


async def main():
    async with async_session_factory() as db:
        rows = (await db.execute(text(
            "SELECT u.tenant_id::text, c.election_id::text, u.id, u.code, u.name "
            "FROM homepage.users u "
            "JOIN tenant_elections te ON te.tenant_id = u.tenant_id "
            "JOIN candidates c ON c.id = te.our_candidate_id "
            "ORDER BY u.id"
        ))).all()

        for tid, eid, hp_uid, code, name in rows:
            print(f"\n=== [{code}] {name} (homepage_user_id={hp_uid}) ===", flush=True)
            try:
                result = await auto_fill_homepage(db, tid, eid, hp_uid)
                await db.commit()
                print(f"  result: {result}", flush=True)
            except Exception as e:
                await db.rollback()
                print(f"  FAILED: {type(e).__name__}: {str(e)[:300]}", flush=True)

        print("\n=== 최종 데이터 ===", flush=True)
        rows = (await db.execute(text("""
            SELECT u.code, u.name,
              (SELECT count(*) FROM homepage.profiles p WHERE p.user_id = u.id) AS profiles,
              (SELECT count(*) FROM homepage.pledges pl WHERE pl.user_id = u.id) AS pledges,
              (SELECT count(*) FROM homepage.external_channels ec WHERE ec.user_id = u.id) AS channels
            FROM homepage.users u ORDER BY u.id
        """))).all()
        for code, name, p, pl, ch in rows:
            print(f"  [{code}] {name}: profiles={p} pledges={pl} channels={ch}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
