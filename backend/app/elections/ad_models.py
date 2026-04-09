"""
ElectionPulse - Ad Tracking Models
Meta(Facebook/Instagram) 광고 추적용 DB 모델.
"""
from sqlalchemy import Column, String, Integer, Float, DateTime, Date, Boolean, JSON, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from app.database import Base


class AdCampaign(Base):
    __tablename__ = "ad_campaigns"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(String, nullable=False, index=True)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id"), nullable=True)

    platform = Column(String, default="meta")  # meta | google (향후)
    ad_library_id = Column(String, unique=True, nullable=True)
    page_name = Column(String, nullable=True)
    page_id = Column(String, nullable=True)

    status = Column(String, default="active")  # active | inactive | removed
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AdCreative(Base):
    __tablename__ = "ad_creatives"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id = Column(UUID(as_uuid=True), ForeignKey("ad_campaigns.id"), nullable=False)

    creative_type = Column(String, default="image")  # image | video | carousel
    text = Column(Text, nullable=True)
    link_url = Column(String, nullable=True)
    image_url = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AdMetrics(Base):
    __tablename__ = "ad_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id = Column(UUID(as_uuid=True), ForeignKey("ad_campaigns.id"), nullable=False)
    date = Column(Date, nullable=False)

    # Meta provides ranges, not exact numbers
    spend_lower = Column(Integer, default=0)
    spend_upper = Column(Integer, default=0)
    impressions_lower = Column(Integer, default=0)
    impressions_upper = Column(Integer, default=0)

    demographic_distribution = Column(JSON, nullable=True)  # {age: {}, gender: {}, region: {}}

    collected_at = Column(DateTime(timezone=True), server_default=func.now())
