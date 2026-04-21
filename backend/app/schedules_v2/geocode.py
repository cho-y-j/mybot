"""
schedules_v2 — 카카오맵 지오코딩
주소 텍스트 → lat/lng + 역지오코딩(행정구역).

키 없으면 조용히 skip (Phase 1에서는 히트맵 미사용이므로 기능적 문제 없음).
"""
from typing import Optional
from uuid import UUID

import httpx
import structlog

from app.config import get_settings

logger = structlog.get_logger()

KAKAO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json"
KAKAO_COORD2ADDR_URL = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json"


async def geocode_address(address: str) -> Optional[dict]:
    """카카오 주소 검색 → 좌표 + 행정구역.

    Returns:
      {lat, lng, sido, sigungu, dong, ri, full_address, kakao_url}
      또는 키 없음/실패 시 None.
    """
    settings = get_settings()
    key = getattr(settings, "KAKAO_REST_API_KEY", "") or ""
    if not key or not address:
        return None

    headers = {"Authorization": f"KakaoAK {key}"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 1) 주소 검색 → 좌표
            resp = await client.get(
                KAKAO_ADDRESS_URL,
                headers=headers,
                params={"query": address, "size": 1},
            )
            if resp.status_code != 200:
                logger.warning(
                    "kakao_geocode_http_fail",
                    status=resp.status_code, addr=address[:50],
                )
                return None

            docs = resp.json().get("documents", []) or []
            if not docs:
                logger.info("kakao_geocode_not_found", addr=address[:50])
                return None

            doc = docs[0]
            lng = float(doc.get("x", 0))
            lat = float(doc.get("y", 0))

            # 지번주소 우선, 없으면 도로명
            ja = doc.get("address") or {}
            ra = doc.get("road_address") or {}
            region1 = ja.get("region_1depth_name") or ra.get("region_1depth_name") or ""
            region2 = ja.get("region_2depth_name") or ra.get("region_2depth_name") or ""
            region3 = ja.get("region_3depth_name") or ra.get("region_3depth_name") or ""
            # region_3depth_h_name 은 행정동 (더 정확) — 역지오코딩으로 재확인

            # 2) 좌표 → 행정동 정확화
            dong = region3
            ri = ""
            try:
                r2 = await client.get(
                    KAKAO_COORD2ADDR_URL,
                    headers=headers,
                    params={"x": lng, "y": lat, "input_coord": "WGS84"},
                )
                if r2.status_code == 200:
                    for d in r2.json().get("documents", []) or []:
                        if d.get("region_type") == "H":  # 행정동
                            dong = d.get("region_3depth_name") or dong
                            ri = d.get("region_4depth_name") or ""
                            break
            except Exception:
                pass

            full_addr = (ra.get("address_name") or ja.get("address_name") or address).strip()
            kakao_url = f"https://map.kakao.com/link/map/{address},{lat},{lng}"

            return {
                "lat": lat,
                "lng": lng,
                "sido": region1 or None,
                "sigungu": region2 or None,
                "dong": dong or None,
                "ri": ri or None,
                "full_address": full_addr,
                "kakao_url": kakao_url,
            }
    except Exception as e:
        logger.warning("kakao_geocode_exception", error=str(e)[:200], addr=address[:50])
        return None


async def trigger_geocode(schedule_id: UUID):
    """일정 생성/수정 후 지오코딩 백필 트리거.
    Celery 태스크로 비동기 실행.
    """
    try:
        from app.schedules_v2.tasks import geocode_schedule_task
        geocode_schedule_task.delay(str(schedule_id))
    except Exception as e:
        logger.warning("geocode_trigger_fail", error=str(e)[:200])
