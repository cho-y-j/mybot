"""
기존 AI 감성 분석 결과 초기화 + 개선된 프롬프트로 재분석.
Usage: cd backend && python -m scripts.reanalyze_all
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy import text
from app.database import async_session_factory
from app.analysis.media_analyzer import analyze_all_media


async def reset_and_reanalyze(tenant_id: str, election_id: str, label: str):
    """기존 AI 분석 결과 초기화 후 재분석."""
    async with async_session_factory() as db:
        # 1. 기존 분석 결과 초기화 (ai_analyzed_at = NULL → 재분석 대상)
        for table in ("news_articles", "community_posts", "youtube_videos"):
            result = await db.execute(text(f"""
                UPDATE {table}
                SET ai_analyzed_at = NULL,
                    sentiment = 'neutral',
                    sentiment_score = 0,
                    strategic_value = NULL,
                    action_type = NULL,
                    action_priority = NULL,
                    action_summary = NULL,
                    ai_summary = NULL,
                    ai_reason = NULL
                WHERE tenant_id = :tid AND election_id = :eid
                  AND ai_analyzed_at IS NOT NULL
            """), {"tid": tenant_id, "eid": election_id})
            print(f"  [{label}] {table}: {result.rowcount}건 초기화")
        await db.commit()

    # 2. 개선된 프롬프트로 재분석 (배치 단위)
    async with async_session_factory() as db:
        result = await analyze_all_media(db, tenant_id, election_id, limit_per_type=200)
        print(f"  [{label}] 재분석 완료:")
        print(f"    뉴스: {result['news'].get('analyzed', 0)}건 (무관: {result['news'].get('irrelevant', 0)})")
        print(f"    유튜브: {result['youtube'].get('analyzed', 0)}건")
        print(f"    커뮤니티: {result['community'].get('analyzed', 0)}건")
        print(f"    사분면: {result['by_quadrant']}")

    # 3. 결과 확인
    async with async_session_factory() as db:
        for table in ("news_articles", "community_posts", "youtube_videos"):
            rows = (await db.execute(text(f"""
                SELECT sentiment, COUNT(*)
                FROM {table}
                WHERE tenant_id = :tid AND election_id = :eid
                  AND ai_analyzed_at IS NOT NULL
                GROUP BY sentiment
            """), {"tid": tenant_id, "eid": election_id})).all()
            if rows:
                dist = {r[0]: r[1] for r in rows}
                total = sum(dist.values())
                print(f"  [{label}] {table} 감성 분포: {dist} (total={total})")
                if total > 0:
                    neutral_pct = round(dist.get("neutral", 0) / total * 100)
                    print(f"    → neutral 비율: {neutral_pct}% {'✅' if neutral_pct < 30 else '⚠️ 여전히 높음'}")


async def main():
    # 모든 활성 tenant+election 조합 조회
    async with async_session_factory() as db:
        rows = (await db.execute(text("""
            SELECT te.tenant_id, te.election_id, t.name as tenant_name, e.name as election_name
            FROM tenant_elections te
            JOIN tenants t ON te.tenant_id = t.id
            JOIN elections e ON te.election_id = e.id
            WHERE te.our_candidate_id IS NOT NULL
            ORDER BY t.name
        """))).all()

    if not rows:
        print("활성 캠프가 없습니다.")
        return

    print(f"\n{'='*60}")
    print(f"감성 분석 재분석 시작 — {len(rows)}개 캠프")
    print(f"{'='*60}\n")

    for tid, eid, tname, ename in rows:
        label = f"{tname}/{ename}"
        print(f"\n▶ {label} (tenant={str(tid)[:8]}, election={str(eid)[:8]})")
        await reset_and_reanalyze(str(tid), str(eid), label)

    print(f"\n{'='*60}")
    print("전체 재분석 완료!")
    print(f"{'='*60}")


if __name__ == "__main__":
    asyncio.run(main())
