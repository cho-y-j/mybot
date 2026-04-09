"""
NESDC (중앙선거여론조사심의위원회) 등록 여론조사 자동 import.

NESDC 사이트(https://www.nesdc.go.kr)는 모든 공식 여론조사를 등록하지만
실제 결과(후보별 지지율)는 첨부 PDF로만 제공. 본 스크립트는 메타정보만 import.
사용자는 surveys 페이지에서 NESDC 원본 링크 클릭 → PDF 보고 수동 등록 가능.

실행:
  python -m scripts.import_nesdc_surveys --election VT026 --sido 충청북도
  python -m scripts.import_nesdc_surveys --election VT026 --sido 충청북도 --start 2025-10-01 --end 2026-04-30
"""
import argparse
import asyncio
import re
import sys
from pathlib import Path
from datetime import date as _date, datetime
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import httpx

from sqlalchemy import select
from app.database import async_session_factory
# 모델 mapper 초기화를 위해 관련 모델 import (Tenant 등)
import app.auth.models  # noqa
from app.elections.models import Survey


NESDC_LIST = "https://www.nesdc.go.kr/portal/bbs/B0000005/list.do"
NESDC_VIEW = "https://www.nesdc.go.kr/portal/bbs/B0000005/view.do"


# 여론조사명칭 → election_type 추론
def infer_election_type(name: str) -> Optional[str]:
    n = name or ""
    if "기초단체장" in n or "시장선거" in n or "군수선거" in n or "구청장선거" in n:
        return "mayor"
    if "광역단체장" in n or "도지사선거" in n or "시장 선거" in n:
        # 시·도지사 선거. 단, 시장과 혼동 주의
        if "광역" in n:
            return "governor"
        return "governor"
    if "교육감" in n:
        return "superintendent"
    if "시·도의원" in n or "시도의원" in n or "광역의원" in n:
        return "metro_council"
    if "구·시·군의원" in n or "기초의원" in n:
        return "basic_council"
    return None


def extract_sigungu(name: str, sido: str) -> Optional[str]:
    """명칭에서 시·군·구 추출. e.g. '충청북도 옥천군 기초단체장…' → '옥천군'."""
    if not name or not sido or sido not in name:
        return None
    after = name.split(sido, 1)[1].strip()
    # 첫 번째 시/군/구 단어
    m = re.match(r"([가-힣]+(?:시|군|구))", after)
    if m:
        return m.group(1)
    return None


_LIST_ROW_RE = re.compile(
    r'<a href="(/portal/bbs/B0000005/view\.do\?nttId=(\d+)[^"]*)"[^>]*class="row tr"[^>]*>(.*?)</a>',
    re.DOTALL,
)
_COL_RE = re.compile(r'<span class="col[^"]*"><i class="tit"></i>([^<]*)</span>', re.DOTALL)


async def fetch_list_page(client: httpx.AsyncClient, *, election_code: str, sido: str,
                          start: str, end: str, page: int = 1) -> tuple[list[dict], int]:
    """NESDC 검색 결과 한 페이지 fetch."""
    params = {
        "menuNo": "200467",
        "sdate": start,
        "edate": end,
        "pollGubuncd": election_code,
        "searchCnd": "4",  # 시도
        "searchWrd": sido,
        "pageIndex": str(page),
    }
    r = await client.get(NESDC_LIST, params=params)
    r.raise_for_status()
    html = r.text

    # total
    m_total = re.search(r"Total <i>(\d+)건", html)
    total = int(m_total.group(1)) if m_total else 0

    items = []
    for m in _LIST_ROW_RE.finditer(html):
        href = m.group(1).replace("&amp;", "&")
        ntt_id = m.group(2)
        body = m.group(3)
        cols = [c.strip() for c in _COL_RE.findall(body)]
        # 컬럼: [등록번호, 조사기관, 의뢰자, 조사방법, 명칭, 등록일, 시도]
        # (추출틀 컬럼은 list 페이지에 없음)
        while len(cols) < 7:
            cols.append("")
        if len(cols) < 5:
            continue
        items.append({
            "ntt_id": ntt_id,
            "url": f"https://www.nesdc.go.kr{href}",
            "regist_no": cols[0],
            "agency": cols[1],
            "client": cols[2],
            "method": cols[3],
            "frame": "",
            "name": cols[4].replace("</br>", " ").replace("<br>", " "),
            "regist_date": cols[5],
            "sido_col": cols[6],
        })
    return items, total


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--election", default="VT026", help="NESDC pollGubuncd 코드 (VT026=9회 지방선거)")
    p.add_argument("--sido", required=True, help="시도명 (예: 충청북도)")
    p.add_argument("--start", default="2025-01-01")
    p.add_argument("--end", default="2026-12-31")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    print(f"=== NESDC import: {args.sido} / 선거={args.election} / {args.start}~{args.end} ===")

    async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}, timeout=30.0) as client:
        all_items = []
        page = 1
        while True:
            items, total = await fetch_list_page(
                client, election_code=args.election, sido=args.sido,
                start=args.start, end=args.end, page=page,
            )
            if not items:
                break
            all_items.extend(items)
            print(f"  page {page}: {len(items)}건 / total {total}")
            if len(all_items) >= total:
                break
            page += 1

    print(f"\n총 fetch: {len(all_items)}건")
    if args.dry_run:
        for it in all_items:
            etype = infer_election_type(it["name"])
            sigungu = extract_sigungu(it["name"], args.sido)
            print(f"  [{etype or '?'}/{sigungu or '-'}] {it['name'][:60]} | {it['agency'][:30]}")
        return

    # DB import
    async with async_session_factory() as db:
        added = 0
        skipped = 0
        for it in all_items:
            etype = infer_election_type(it["name"])
            sigungu = extract_sigungu(it["name"], args.sido)

            # 등록번호 기준 중복 방지 (source_url에 nttId 포함)
            existing = (await db.execute(
                select(Survey).where(Survey.source_url == it["url"])
            )).scalar_one_or_none()
            if existing:
                # 메타 업데이트
                existing.election_type = etype
                existing.region_sido = args.sido
                skipped += 1
                continue

            try:
                d = datetime.strptime(it["regist_date"], "%Y-%m-%d").date()
            except Exception:
                d = _date.today()

            db.add(Survey(
                tenant_id=None,  # 공공 데이터 — 모든 캠프 공유
                survey_org=it["agency"][:200],
                client_org=it["client"][:200] if it["client"] else None,
                survey_date=d,
                method=it["method"][:100] if it["method"] else None,
                source_url=it["url"],
                election_type=etype,
                region_sido=args.sido,
                region_sigungu=sigungu,
                results={},  # PDF 첨부에만 있음 — 사용자가 NESDC 원본 보고 수동 입력
                collected_at=datetime.utcnow(),
            ))
            added += 1

        await db.commit()
        print(f"\n=== 완료 ===")
        print(f"신규 적재: {added}건")
        print(f"기존 업데이트: {skipped}건")


if __name__ == "__main__":
    asyncio.run(main())
