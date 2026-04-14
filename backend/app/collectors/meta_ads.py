"""
ElectionPulse - Meta Ad Library Collector
Facebook/Instagram 광고 라이브러리 API 수집기.
Rate limit: 분당 200 요청. 지수 백오프 적용.
"""
import asyncio
import os
import structlog
from datetime import date, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import httpx

from app.elections.models import Election, Candidate
from app.elections.ad_models import AdCampaign, AdCreative, AdMetrics

logger = structlog.get_logger()

META_AD_LIBRARY_URL = "https://graph.facebook.com/v18.0/ads_archive"


async def collect_meta_ads(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    limit: int = 50,
) -> dict:
    """
    Meta Ad Library API로 후보별 광고 수집.
    Returns: {collected: int, errors: list}
    """
    from app.config import get_settings
    access_token = get_settings().META_AD_LIBRARY_TOKEN
    if not access_token:
        return {"collected": 0, "errors": ["META_AD_LIBRARY_TOKEN 환경변수가 설정되지 않았습니다"]}

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"collected": 0, "errors": ["선거 정보 없음"]}

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.enabled == True,
        )
    )).scalars().all()

    collected = 0
    errors = []
    search_log = []

    async with httpx.AsyncClient(timeout=30) as client:
        for candidate in candidates:
            try:
                ads = await _search_ads(
                    client, access_token,
                    search_term=candidate.name,
                    country="KR",
                    limit=min(limit, 50),
                )
                search_log.append({
                    "candidate": candidate.name,
                    "search_term": candidate.name,
                    "results_found": len(ads),
                })

                for ad in ads:
                    # 중복 체크
                    existing = (await db.execute(
                        select(AdCampaign).where(
                            AdCampaign.ad_library_id == ad.get("id")
                        )
                    )).scalar_one_or_none()

                    if existing:
                        continue

                    campaign = AdCampaign(
                        tenant_id=tenant_id,
                        election_id=election_id,
                        candidate_id=candidate.id,
                        platform="meta",
                        ad_library_id=ad.get("id"),
                        page_name=ad.get("page_name"),
                        page_id=ad.get("page_id"),
                        status="active" if ad.get("ad_delivery_start_time") else "inactive",
                    )
                    db.add(campaign)
                    await db.flush()

                    # Creative
                    snapshot = ad.get("ad_creative_bodies", [""])[0] if ad.get("ad_creative_bodies") else ""
                    link = ad.get("ad_creative_link_captions", [""])[0] if ad.get("ad_creative_link_captions") else ""
                    creative = AdCreative(
                        campaign_id=campaign.id,
                        creative_type="image",
                        text=snapshot[:2000] if snapshot else None,
                        link_url=link[:500] if link else None,
                    )
                    db.add(creative)

                    # Metrics (spend range)
                    spend = ad.get("spend", {})
                    impressions = ad.get("impressions", {})
                    demographics = ad.get("demographic_distribution", {})

                    metrics = AdMetrics(
                        campaign_id=campaign.id,
                        date=date.today(),
                        spend_lower=int(spend.get("lower_bound", 0)) if spend else 0,
                        spend_upper=int(spend.get("upper_bound", 0)) if spend else 0,
                        impressions_lower=int(impressions.get("lower_bound", 0)) if impressions else 0,
                        impressions_upper=int(impressions.get("upper_bound", 0)) if impressions else 0,
                        demographic_distribution=demographics or None,
                    )
                    db.add(metrics)
                    collected += 1

                await db.commit()
                # Rate limiting: 후보 간 0.5초 대기
                await asyncio.sleep(0.5)

            except Exception as e:
                logger.error("meta_ads_collect_error", candidate=candidate.name, error=str(e)[:200])
                errors.append(f"{candidate.name}: {str(e)[:100]}")

    return {
        "collected": collected,
        "errors": errors,
        "search_log": search_log,
        "candidates_searched": len(candidates),
        "message": f"{len(candidates)}명 후보 검색 완료. {collected}건 수집." + (
            " Meta에 해당 후보의 광고가 없습니다." if collected == 0 and not errors else ""
        ),
    }


async def _search_ads(
    client: httpx.AsyncClient,
    access_token: str,
    search_term: str,
    country: str = "KR",
    limit: int = 50,
    retries: int = 3,
) -> list:
    """Meta Ad Library API 검색 (지수 백오프)."""
    params = {
        "access_token": access_token,
        "search_terms": search_term,
        "ad_reached_countries": country,
        "ad_type": "ALL",
        "fields": "id,page_name,page_id,ad_creative_bodies,ad_creative_link_captions,spend,impressions,demographic_distribution,ad_delivery_start_time",
        "limit": limit,
    }

    for attempt in range(retries):
        try:
            resp = await client.get(META_AD_LIBRARY_URL, params=params)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("data", [])
            elif resp.status_code == 429:
                wait = 2 ** (attempt + 1)
                logger.warning("meta_ads_rate_limited", wait=wait, attempt=attempt)
                await asyncio.sleep(wait)
            else:
                logger.error("meta_ads_api_error", status=resp.status_code, body=resp.text[:200])
                return []
        except Exception as e:
            if attempt < retries - 1:
                await asyncio.sleep(2 ** attempt)
            else:
                raise

    return []
