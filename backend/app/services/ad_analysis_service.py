"""
ElectionPulse - Ad Analysis Service
광고 데이터 분석 + 대시보드 데이터 제공.
"""
import structlog
from collections import defaultdict
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import Candidate
from app.elections.ad_models import AdCampaign, AdCreative, AdMetrics

logger = structlog.get_logger()


async def get_ad_analysis(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
) -> dict:
    """
    광고 분석 대시보드 데이터.
    Returns: {candidates[], total_spend, creative_types, demographics}
    """
    from app.common.election_access import get_election_tenant_ids
    all_tids = await get_election_tenant_ids(db, election_id)

    # 후보별 광고 집계
    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id.in_(all_tids),
            Candidate.enabled == True,
        )
    )).scalars().all()

    result = []
    total_campaigns = 0
    total_spend_upper = 0

    for c in candidates:
        campaigns = (await db.execute(
            select(AdCampaign).where(
                AdCampaign.candidate_id == c.id,
                AdCampaign.election_id == election_id,
            )
        )).scalars().all()

        if not campaigns:
            result.append({
                "name": c.name,
                "is_ours": c.is_our_candidate,
                "campaigns": 0,
                "spend_range": {"lower": 0, "upper": 0},
                "impressions_range": {"lower": 0, "upper": 0},
                "creatives": [],
            })
            continue

        campaign_ids = [camp.id for camp in campaigns]

        # 지출 집계
        metrics = (await db.execute(
            select(
                func.sum(AdMetrics.spend_lower).label("spend_low"),
                func.sum(AdMetrics.spend_upper).label("spend_up"),
                func.sum(AdMetrics.impressions_lower).label("imp_low"),
                func.sum(AdMetrics.impressions_upper).label("imp_up"),
            ).where(AdMetrics.campaign_id.in_(campaign_ids))
        )).one()

        spend_lower = int(metrics.spend_low or 0)
        spend_upper = int(metrics.spend_up or 0)
        total_spend_upper += spend_upper

        # 크리에이티브 샘플
        creatives = (await db.execute(
            select(AdCreative).where(
                AdCreative.campaign_id.in_(campaign_ids)
            ).limit(10)
        )).scalars().all()

        creative_list = [{
            "type": cr.creative_type,
            "text": (cr.text[:200] + "...") if cr.text and len(cr.text) > 200 else cr.text,
            "link": cr.link_url,
            "image": cr.image_url,
        } for cr in creatives]

        result.append({
            "name": c.name,
            "is_ours": c.is_our_candidate,
            "campaigns": len(campaigns),
            "spend_range": {"lower": spend_lower, "upper": spend_upper},
            "impressions_range": {"lower": int(metrics.imp_low or 0), "upper": int(metrics.imp_up or 0)},
            "creatives": creative_list,
        })

        total_campaigns += len(campaigns)

    # 크리에이티브 유형 분포
    type_counts = (await db.execute(
        select(AdCreative.creative_type, func.count())
        .join(AdCampaign, AdCreative.campaign_id == AdCampaign.id)
        .where(AdCampaign.election_id == election_id)
        .group_by(AdCreative.creative_type)
    )).all()

    creative_types = {t: c for t, c in type_counts}

    return {
        "candidates": result,
        "total_campaigns": total_campaigns,
        "total_spend_upper": total_spend_upper,
        "creative_types": creative_types,
        "platform": "Meta (Facebook/Instagram)",
    }
