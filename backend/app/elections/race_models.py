"""
ElectionPulse - Race-Shared Models (P2-01)

같은 선거(race)에 참여하는 여러 캠프가 수집/분석/저장 비용을 공유.
한 선거당 1회 수집 → 캠프별 관점만 overlay.

설계 문서: docs/P2-01_race_shared_design.md
마이그레이션: backend/scripts/p2_01_race_shared_migration.sql
"""
from datetime import datetime
import uuid

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Index, String, Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


def _utcnow():
    return datetime.utcnow()


class RaceNewsArticle(Base):
    """선거 단위로 공유되는 뉴스 기사. tenant_id 없음 (race 중립)."""
    __tablename__ = "race_news_articles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    election_id = Column(
        UUID(as_uuid=True),
        ForeignKey("elections.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 원본 데이터
    title = Column(String(500), nullable=False)
    url = Column(String(1000), nullable=False)
    source = Column(String(200), nullable=True)
    summary = Column(Text, nullable=True)
    platform = Column(String(50), nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    collected_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    # Race-level AI 분석 (tenant 중립적 팩트 요약)
    ai_summary = Column(Text, nullable=True)
    ai_topics = Column(JSONB, default=list)
    ai_threat_level = Column(String(20), nullable=True)
    sentiment = Column(String(20), nullable=True)
    sentiment_score = Column(Float, nullable=True)
    sentiment_verified = Column(Boolean, default=False)
    ai_analyzed_at = Column(DateTime(timezone=True), nullable=True)

    # 관계
    camp_analyses = relationship(
        "RaceNewsCampAnalysis",
        back_populates="race_news",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("election_id", "url", name="uq_race_news_url_per_election"),
        Index("ix_race_news_election_date", "election_id", "published_at"),
    )


class RaceNewsCampAnalysis(Base):
    """캠프별 관점에서 본 race_news_articles 1건의 4사분면 분류.

    같은 기사가 A캠프 관점 weakness이고 B캠프 관점 opportunity일 수 있음.
    """
    __tablename__ = "race_news_camp_analysis"

    race_news_id = Column(
        UUID(as_uuid=True),
        ForeignKey("race_news_articles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
    )
    candidate_id = Column(UUID(as_uuid=True), nullable=True)

    is_about_our_candidate = Column(Boolean, default=False)
    strategic_quadrant = Column(String(20), nullable=True)
    strategic_value = Column(String(20), nullable=True)
    action_type = Column(String(20), nullable=True)
    action_priority = Column(String(10), nullable=True)
    action_summary = Column(Text, nullable=True)
    ai_reason = Column(Text, nullable=True)

    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    race_news = relationship("RaceNewsArticle", back_populates="camp_analyses")

    __table_args__ = (
        Index("ix_rnca_tenant_quadrant", "tenant_id", "strategic_quadrant"),
        Index("ix_rnca_candidate", "candidate_id"),
    )
