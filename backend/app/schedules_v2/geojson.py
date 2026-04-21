"""
schedules_v2 — 행정동 경계 GeoJSON 서빙

전국 GeoJSON(vuski/admdongkor ver20260201, 34MB)을 backend/data/geo/에 정적 보관.
API는 election의 election_type·region_sido·region_sigungu 기준으로 필터링하여 반환.

범위 규칙:
  superintendent(교육감) / governor(도지사) → sido 전체
  mayor(시장) / council(의원)                → sido + sigungu (시/구 단위)
  president(대통령)                          → 전국
  congressional(국회의원)                    → sigungu 단위 근사

좌표 precision 5자리(1m 정확도)로 축소하여 응답 크기 60% 감소.
응답은 FastAPI 내장 서버 캐시 대신 HTTP Cache-Control 1일.
"""
import json
import os
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.common.election_access import can_access_election
from app.elections.models import Election

logger = structlog.get_logger()

router = APIRouter()

GEO_DATA_DIR = Path(__file__).parent.parent.parent / "data" / "geo"
GEO_FILE = GEO_DATA_DIR / "HangJeongDong_ver20260201.geojson"

# 시도명 정규화 (election.region_sido가 "충북" vs GeoJSON "충청북도" 차이 해소)
SIDO_ALIASES = {
    "서울": "서울특별시", "서울시": "서울특별시",
    "부산": "부산광역시", "부산시": "부산광역시",
    "대구": "대구광역시", "대구시": "대구광역시",
    "인천": "인천광역시", "인천시": "인천광역시",
    "광주": "광주광역시", "광주시": "광주광역시",
    "대전": "대전광역시", "대전시": "대전광역시",
    "울산": "울산광역시", "울산시": "울산광역시",
    "세종": "세종특별자치시", "세종시": "세종특별자치시",
    "경기": "경기도",
    "강원": "강원특별자치도",
    "충북": "충청북도", "충남": "충청남도",
    "전북": "전북특별자치도",
    "전남": "전라남도",
    "경북": "경상북도", "경남": "경상남도",
    "제주": "제주특별자치도",
}


def _normalize_sido(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    return SIDO_ALIASES.get(s, s)


def _round_coords(coords, precision: int = 5):
    """GeoJSON 좌표 배열 재귀 round. [lng, lat] 튜플 depth 무관."""
    if isinstance(coords, (int, float)):
        return round(coords, precision)
    if isinstance(coords, list):
        return [_round_coords(c, precision) for c in coords]
    return coords


@lru_cache(maxsize=1)
def _load_all() -> dict:
    """전국 GeoJSON 메모리 로드 (프로세스당 1회). 34MB."""
    if not GEO_FILE.exists():
        logger.warning("geojson_file_missing", path=str(GEO_FILE))
        return {"type": "FeatureCollection", "features": []}

    with open(GEO_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    logger.info("geojson_loaded", features=len(data.get("features", [])))
    return data


def _filter_by_scope(
    features: list,
    sido: Optional[str],
    sigungu: Optional[str],
    scope: str,
) -> list:
    """
    scope:
      - 'nationwide': 전국
      - 'sido': sido만 (sigungu 무시)
      - 'sigungu': sido + sigungu 모두 일치
    """
    if scope == "nationwide":
        return features
    if scope == "sido" and sido:
        return [f for f in features if f["properties"].get("sidonm") == sido]
    if scope == "sigungu" and sido and sigungu:
        return [
            f for f in features
            if f["properties"].get("sidonm") == sido
            and sigungu in (f["properties"].get("adm_nm") or "")
        ]
    return []


def _determine_scope(election_type: str) -> str:
    et = (election_type or "").lower()
    if et in ("president", "presidential"):
        return "nationwide"
    if et in ("superintendent", "governor"):
        return "sido"
    if et in ("mayor", "council", "congressional"):
        return "sigungu"
    return "sido"  # 안전 기본값


@router.get("/{election_id}/geojson")
async def election_geojson(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    candidate_id: Optional[UUID] = None,
    days: int = 60,
    precision: int = 5,
):
    """election 범위 행정동 GeoJSON + 우리 후보 방문 횟수 + 인구 통합."""
    from sqlalchemy import text as sql_text

    # 권한
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(403, "No tenant")
    if not user.get("is_superadmin"):
        if not await can_access_election(db, tid, election_id):
            raise HTTPException(403, "election access denied")

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        raise HTTPException(404, "election not found")

    sido = _normalize_sido(election.region_sido)
    sigungu = election.region_sigungu
    scope = _determine_scope(election.election_type)

    data = _load_all()
    features = _filter_by_scope(data.get("features", []), sido, sigungu, scope)

    # 후보 방문 횟수 집계 (admin_dong 기준)
    if not candidate_id:
        from app.common.election_access import get_our_candidate_id
        our_id = await get_our_candidate_id(db, tid, election_id)
        cid_str = our_id
    else:
        cid_str = str(candidate_id)

    visits_map: dict[str, int] = {}       # admin_dong → visits
    last_visit_map: dict[str, str] = {}   # admin_dong → iso string
    if cid_str:
        visit_rows = (await db.execute(sql_text(f"""
            SELECT admin_dong, COUNT(*)::int AS cnt, MAX(starts_at) AS last_at
              FROM candidate_schedules
             WHERE candidate_id = cast(:cid as uuid)
               AND admin_dong IS NOT NULL
               AND status != 'canceled'
               AND starts_at >= NOW() - INTERVAL '{int(days)} days'
             GROUP BY admin_dong
        """), {"cid": cid_str})).mappings().all()
        for v in visit_rows:
            visits_map[v["admin_dong"]] = v["cnt"]
            if v["last_at"]:
                last_visit_map[v["admin_dong"]] = v["last_at"].isoformat()

    # 인구 데이터 — adm_cd 10자리 기준 (admin_population)
    pop_map: dict[str, dict] = {}
    adm_codes = list({f.get("properties", {}).get("adm_cd2") for f in features if f.get("properties", {}).get("adm_cd2")})
    if adm_codes:
        pop_rows = (await db.execute(sql_text("""
            SELECT adm_cd, total, male, female, prd_de
              FROM admin_population
             WHERE adm_cd = ANY(:codes) AND level = 10
        """), {"codes": adm_codes})).mappings().all()
        for p in pop_rows:
            pop_map[p["adm_cd"]] = {
                "total": p["total"],
                "male": p["male"],
                "female": p["female"],
                "prd_de": p["prd_de"],
            }

    # 좌표 precision 축소 + properties 통합
    slim = []
    for f in features:
        p = f.get("properties", {})
        adm_cd2 = p.get("adm_cd2")
        adm_nm_full = p.get("adm_nm") or ""
        # GeoJSON adm_nm = "충청북도 청주시 상당구 용암1동" → 마지막 토큰이 동 이름
        # candidate_schedules.admin_dong = "용암1동" (카카오 역지오코딩) — 동 이름만 매칭
        dong_short = adm_nm_full.split()[-1] if adm_nm_full else ""

        visits = visits_map.get(dong_short, 0)
        last_visit = last_visit_map.get(dong_short)
        pop = pop_map.get(adm_cd2, {})

        geo = f.get("geometry")
        if geo and 1 <= precision <= 6:
            geo = {
                "type": geo.get("type"),
                "coordinates": _round_coords(geo.get("coordinates"), precision=precision),
            }

        slim.append({
            "type": "Feature",
            "properties": {
                "adm_nm": adm_nm_full,
                "adm_cd": p.get("adm_cd"),
                "adm_cd2": adm_cd2,
                "sidonm": p.get("sidonm"),
                "sggnm": p.get("sggnm"),
                "dong_short": dong_short,
                "visits": visits,
                "last_visit_at": last_visit,
                "population": pop.get("total"),
                "pop_male": pop.get("male"),
                "pop_female": pop.get("female"),
                "pop_period": pop.get("prd_de"),
            },
            "geometry": geo,
        })

    logger.info(
        "geojson_served",
        election_id=str(election_id),
        scope=scope, sido=sido, sigungu=sigungu,
        feature_count=len(slim),
        visited=len(visits_map), populations=len(pop_map),
    )

    return {
        "type": "FeatureCollection",
        "features": slim,
        "scope": scope,
        "election": {
            "name": election.name,
            "type": election.election_type,
            "sido": election.region_sido,
            "sigungu": election.region_sigungu,
        },
        "candidate_id": cid_str,
        "days": days,
        "version": "ver20260201",
        "generated_at": date.today().isoformat(),
    }
