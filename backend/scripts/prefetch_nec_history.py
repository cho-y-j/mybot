"""
NEC 역대 선거 데이터 사전 fetch — 17개 시도 × 5개 election_type.

실행:
    cd backend
    python -m scripts.prefetch_nec_history
    # 또는 특정 시도만:
    python -m scripts.prefetch_nec_history --sido 충청북도
    # 특정 유형만:
    python -m scripts.prefetch_nec_history --types governor mayor
    # dry-run:
    python -m scripts.prefetch_nec_history --dry-run

이 스크립트는 NEC 공공 OpenAPI에서 후보별 결과(시·군·구 단위)를 받아
election_results 테이블에 tenant_id=NULL로 저장. 모든 캠프가 자동으로 공유.
재실행 안전 (멱등) — fetch_and_store_history()가 중복 체크함.
"""
import argparse
import asyncio
import sys
from pathlib import Path

# backend 디렉토리를 sys.path에 추가
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.database import async_session_factory
from app.collectors.nec_api import fetch_and_store_history


# 17개 시·도 (NEC sdName 형식)
ALL_SIDO = [
    "서울특별시", "부산광역시", "대구광역시", "인천광역시",
    "광주광역시", "대전광역시", "울산광역시", "세종특별자치시",
    "경기도", "강원특별자치도", "충청북도", "충청남도",
    "전북특별자치도", "전라남도", "경상북도", "경상남도",
    "제주특별자치도",
]

# 5개 election_type (sgTypecode 매핑은 nec_api.ELECTION_TYPE_CODES 참조)
DEFAULT_TYPES = ["governor", "mayor", "metro_council", "basic_council", "superintendent"]


async def fetch_one(sido: str, etype: str, dry_run: bool = False) -> dict:
    """단일 (시도, 유형) 조합 fetch."""
    if dry_run:
        return {"region": sido, "type": etype, "dry_run": True}

    async with async_session_factory() as db:
        try:
            result = await fetch_and_store_history(db, sido, etype, tenant_id=None)
            await db.commit()
            return result
        except Exception as e:
            await db.rollback()
            return {"region": sido, "type": etype, "error": str(e)[:200]}


async def main():
    parser = argparse.ArgumentParser(description="NEC 역대 선거 데이터 사전 fetch")
    parser.add_argument("--sido", action="append", help="특정 시도만 (복수 지정 가능)")
    parser.add_argument("--types", nargs="+", default=DEFAULT_TYPES, help="election_type 리스트")
    parser.add_argument("--dry-run", action="store_true", help="실제 호출 없이 조합만 출력")
    parser.add_argument("--concurrency", type=int, default=2, help="동시 fetch 수 (NEC API rate limit 주의)")
    args = parser.parse_args()

    sidos = args.sido or ALL_SIDO
    types = args.types

    combos = [(s, t) for s in sidos for t in types]
    total = len(combos)

    print(f"=== NEC 사전 fetch 시작 ===")
    print(f"시도: {len(sidos)}개")
    print(f"유형: {types}")
    print(f"총 조합: {total}개")
    print(f"동시 실행: {args.concurrency}")
    print(f"dry-run: {args.dry_run}")
    print()

    sem = asyncio.Semaphore(args.concurrency)

    async def run_one(sido, etype, idx):
        async with sem:
            print(f"[{idx}/{total}] {sido} / {etype} ... ", end="", flush=True)
            result = await fetch_one(sido, etype, dry_run=args.dry_run)
            if result.get("error"):
                print(f"❌ {result['error'][:80]}")
            elif result.get("dry_run"):
                print("(dry-run)")
            else:
                imported = result.get("records_imported", 0)
                skipped = result.get("skipped_existing", 0)
                elections = result.get("elections_found", 0)
                print(f"✅ {elections}회 / {imported}건 신규 / {skipped}건 중복")
            return result

    tasks = [run_one(s, t, i + 1) for i, (s, t) in enumerate(combos)]
    results = await asyncio.gather(*tasks)

    # 요약
    print()
    print("=== 완료 ===")
    total_imported = sum((r.get("records_imported") or 0) for r in results)
    total_skipped = sum((r.get("skipped_existing") or 0) for r in results)
    total_errors = sum(1 for r in results if r.get("error"))
    print(f"신규 적재: {total_imported}건")
    print(f"중복 스킵: {total_skipped}건")
    print(f"에러: {total_errors}개 조합")

    if total_errors > 0:
        print()
        print("실패 조합:")
        for r in results:
            if r.get("error"):
                print(f"  - {r['region']} / {r['type']}: {r['error'][:120]}")


if __name__ == "__main__":
    asyncio.run(main())
