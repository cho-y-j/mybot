"""
KOSIS 주민등록인구 (읍면동 단위) → admin_population 테이블 캐시.
월 1회 실행.

통계표: DT_1B04005N 행정구역(읍면동)별/5세별 주민등록인구
항목: T2=총인구, T3=남자, T4=여자
분류: objL1=ALL (전국 모든 행정구역), objL2=0 (전 연령 합계)

사용:
  docker exec ep_backend python -m app._fetch_kosis_pop
"""
import os
import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import get_settings

settings = get_settings()
SYNC_URL = settings.DATABASE_URL.replace("+asyncpg", "+psycopg2")
engine = create_engine(SYNC_URL, pool_pre_ping=True)

API_URL = "https://kosis.kr/openapi/Param/statisticsParameterData.do"


def fetch_item(api_key: str, item_id: str) -> list[dict]:
    """KOSIS에서 특정 항목(T2/T3/T4) 전체 행정구역 데이터 fetch."""
    params = {
        "method": "getList",
        "apiKey": api_key,
        "orgId": "101",
        "tblId": "DT_1B04005N",
        "itmId": f"{item_id}+",
        "objL1": "ALL",
        "objL2": "0+",
        "format": "json",
        "jsonVD": "Y",
        "prdSe": "M",
        "newEstPrdCnt": "1",
    }
    r = httpx.get(API_URL, params=params, timeout=120.0)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and "err" in data:
        raise RuntimeError(f"KOSIS err: {data}")
    return data


def upsert_population(rows: dict[str, dict]) -> int:
    """rows = {adm_cd: {adm_nm, total, male, female, prd_de, level}} → DB upsert."""
    with Session(engine) as sess:
        count = 0
        for adm_cd, r in rows.items():
            sess.execute(text("""
                INSERT INTO admin_population
                    (adm_cd, adm_nm, total, male, female, level, prd_de, updated_at)
                VALUES
                    (:cd, :nm, :t, :m, :f, :lv, :prd, NOW())
                ON CONFLICT (adm_cd) DO UPDATE SET
                    adm_nm = EXCLUDED.adm_nm,
                    total = EXCLUDED.total,
                    male = EXCLUDED.male,
                    female = EXCLUDED.female,
                    prd_de = EXCLUDED.prd_de,
                    updated_at = NOW()
            """), {
                "cd": adm_cd, "nm": r["adm_nm"],
                "t": r["total"], "m": r.get("male"), "f": r.get("female"),
                "lv": r["level"], "prd": r["prd_de"],
            })
            count += 1
        sess.commit()
        return count


def main():
    api_key = os.environ.get("KOSIS_API_KEY") or getattr(settings, "KOSIS_API_KEY", "")
    if not api_key:
        raise SystemExit("KOSIS_API_KEY env required")

    print("[1/3] 총인구 fetch...")
    total_rows = fetch_item(api_key, "T2")
    print(f"  rows={len(total_rows)}")

    print("[2/3] 남/여 fetch...")
    male_rows = fetch_item(api_key, "T3")
    female_rows = fetch_item(api_key, "T4")

    # 병합 by adm_cd
    merged: dict[str, dict] = {}
    for r in total_rows:
        cd = r["C1"]
        merged[cd] = {
            "adm_nm": r.get("C1_NM", "") or "",
            "total": int(r.get("DT", 0) or 0),
            "male": None, "female": None,
            "level": len(cd),
            "prd_de": r.get("PRD_DE", ""),
        }
    for r in male_rows:
        cd = r["C1"]
        if cd in merged:
            merged[cd]["male"] = int(r.get("DT", 0) or 0)
    for r in female_rows:
        cd = r["C1"]
        if cd in merged:
            merged[cd]["female"] = int(r.get("DT", 0) or 0)

    print(f"[3/3] DB upsert {len(merged)}건...")
    n = upsert_population(merged)
    print(f"완료: {n}건 저장")


if __name__ == "__main__":
    main()
