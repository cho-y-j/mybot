"""YouTube 기존 수집물의 실제 publishedAt 복원.

언제 실행: YouTube API 쿼터가 리셋된 후 (한국 시간 오후 4~5시 경).
비용: 50개 배치 × 6번 = 6 units (videos.list는 1 unit/call).
무엇: published_at IS NULL인 YouTube video를 YouTube Data API v3 videos.list로 조회해서
     snippet.publishedAt 값으로 UPDATE.

사용법:
    cd backend && .venv/bin/python3 -m scripts.restore_yt_dates

옵션:
    --dry-run   : DB UPDATE 없이 결과만 출력
    --limit N   : 처리 개수 제한 (기본 전체)

주의: YouTube 페이지 스크래핑과 달리 이 스크립트는 공식 API만 사용한다.
쿼터 초과(403) 시 즉시 중단하고 남은 대상을 로그로 출력한다.
"""
import asyncio
import os
import sys
from typing import Optional

# 프로젝트 루트(backend)를 sys.path에 추가 — 스크립트 단독 실행 가능하게
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import app.auth.models  # noqa: F401 — ORM 사전 로드
import app.elections.models  # noqa: F401


async def fetch_video_publish_dates(client, api_key: str, video_ids: list[str]) -> dict[str, str]:
    """videos.list API로 여러 video_id의 publishedAt 조회."""
    if not video_ids:
        return {}
    try:
        resp = await client.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={
                "part": "snippet",
                "id": ",".join(video_ids),
                "key": api_key,
            },
            timeout=20,
        )
        if resp.status_code == 403:
            raise RuntimeError(f"QUOTA EXCEEDED — 내일 다시 시도하세요 ({resp.text[:200]})")
        if resp.status_code != 200:
            print(f"  API error {resp.status_code}: {resp.text[:200]}")
            return {}
        data = resp.json()
        result = {}
        for item in data.get("items", []):
            vid = item.get("id")
            pub = item.get("snippet", {}).get("publishedAt")
            if vid and pub:
                result[vid] = pub
        return result
    except RuntimeError:
        raise
    except Exception as e:
        print(f"  request failed: {str(e)[:200]}")
        return {}


async def main(dry_run: bool = False, limit: Optional[int] = None):
    from app.database import async_session_factory
    from app.config import get_settings
    from sqlalchemy import text
    import httpx

    settings = get_settings()
    api_key = settings.YOUTUBE_API_KEY or settings.GOOGLE_API_KEY
    if not api_key:
        print("❌ YOUTUBE_API_KEY 또는 GOOGLE_API_KEY 설정이 없습니다.")
        return 1

    # 1. NULL published_at인 YouTube 행 조회
    async with async_session_factory() as db:
        q = text("""
            SELECT id, video_id FROM youtube_videos
            WHERE published_at IS NULL AND video_id IS NOT NULL
            ORDER BY collected_at DESC
        """)
        rows = (await db.execute(q)).all()

    if limit:
        rows = rows[:limit]

    if not rows:
        print("✓ 복원할 YouTube 영상이 없습니다. (published_at NULL인 행 없음)")
        return 0

    print(f"대상: {len(rows)}건")
    print(f"모드: {'DRY-RUN' if dry_run else 'LIVE UPDATE'}")
    print(f"API 비용 예상: {(len(rows) + 49) // 50} units (videos.list × 배치 수)\n")

    # 2. 50개 배치 API 호출
    updated_total = 0
    failed_total = 0
    not_found = []
    async with httpx.AsyncClient() as client:
        for i in range(0, len(rows), 50):
            batch = rows[i:i + 50]
            ids = [r.video_id for r in batch]
            try:
                pub_map = await fetch_video_publish_dates(client, api_key, ids)
            except RuntimeError as e:
                print(f"\n❌ {e}")
                print(f"   중단: {updated_total}건 업데이트, {len(rows) - updated_total - failed_total}건 미처리")
                return 2

            batch_ok = 0
            for r in batch:
                real_pub = pub_map.get(r.video_id)
                if not real_pub:
                    not_found.append(r.video_id)
                    failed_total += 1
                    continue
                if not dry_run:
                    async with async_session_factory() as db:
                        await db.execute(
                            text("UPDATE youtube_videos SET published_at = :pub::timestamptz WHERE id = :id"),
                            {"pub": real_pub, "id": str(r.id)},
                        )
                        await db.commit()
                batch_ok += 1
                updated_total += 1
            print(f"  batch {i // 50 + 1}: {batch_ok}/{len(batch)} updated")

    print(f"\n== 완료 ==")
    print(f"업데이트: {updated_total}건")
    print(f"실패: {failed_total}건 (video_id 영상 삭제/비공개 가능성)")
    if not_found[:5]:
        print(f"  실패 예시: {not_found[:5]}")

    # 3. 결과 날짜 분포
    async with async_session_factory() as db:
        rows2 = (await db.execute(text("""
            SELECT DATE(published_at) d, COUNT(*) c FROM youtube_videos
            WHERE published_at IS NOT NULL
            GROUP BY DATE(published_at) ORDER BY d DESC LIMIT 15
        """))).all()
        print("\n복원 후 YouTube 실제 업로드 날짜 분포 (최근 15일):")
        for r in rows2:
            print(f"  {r.d}: {r.c}건")

    return 0


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="YouTube publishedAt 복원 (API 쿼터 필요)")
    parser.add_argument("--dry-run", action="store_true", help="DB 변경 없이 결과만 출력")
    parser.add_argument("--limit", type=int, help="처리 개수 제한")
    args = parser.parse_args()
    code = asyncio.run(main(dry_run=args.dry_run, limit=args.limit))
    sys.exit(code)
