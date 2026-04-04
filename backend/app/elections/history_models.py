"""
ElectionPulse - 과거 선거 + 여론조사 + 인구통계 모델
선관위 데이터 기반 역대 선거 분석
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Date, Float, ForeignKey,
    Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class VoterTurnout(Base):
    """투표율 (연령별/성별/지역별) — 선관위 데이터."""
    __tablename__ = "voter_turnout"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=True, comment="null=공공데이터(모든 테넌트 공유)")

    election_number = Column(Integer, nullable=False, comment="제N회 (예: 8)")
    election_type = Column(String(50), nullable=False, comment="superintendent|mayor|governor|council")
    election_year = Column(Integer, nullable=False)
    region_sido = Column(String(50), nullable=True)
    region_sigungu = Column(String(50), nullable=True)

    # 분류
    category = Column(String(30), nullable=False, comment="total|age|gender|district|early_voting|sample")
    segment = Column(String(50), nullable=True, comment="18-29|30-39|남|여|사전투표|선거일투표 등")

    # 수치
    eligible_voters = Column(Integer, nullable=True, comment="선거인수")
    actual_voters = Column(Integer, nullable=True, comment="투표자수")
    turnout_rate = Column(Float, nullable=True, comment="투표율 %")

    __table_args__ = (
        Index("ix_turnout_election", "election_number", "election_type"),
        Index("ix_turnout_region", "region_sido", "region_sigungu"),
    )


class ElectionResult(Base):
    """역대 선거 개표 결과 — 선관위 데이터."""
    __tablename__ = "election_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=True)

    election_number = Column(Integer, nullable=False)
    election_type = Column(String(50), nullable=False)
    election_year = Column(Integer, nullable=False)
    region_sido = Column(String(50), nullable=False)
    region_sigungu = Column(String(50), nullable=True)

    candidate_name = Column(String(100), nullable=False)
    party = Column(String(100), nullable=True)
    votes = Column(Integer, nullable=True)
    vote_rate = Column(Float, nullable=True, comment="득표율 %")
    is_winner = Column(Boolean, default=False)
    candidate_number = Column(Integer, nullable=True, comment="기호 번호")

    __table_args__ = (
        Index("ix_results_election", "election_number", "election_type", "region_sido"),
    )


class RegionalDemographic(Base):
    """지역 인구통계 — 연령/성별/유권자 수."""
    __tablename__ = "regional_demographics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=True)

    region_sido = Column(String(50), nullable=False)
    region_sigungu = Column(String(50), nullable=True)
    data_year = Column(Integer, nullable=False)

    # 인구 데이터
    total_population = Column(Integer, nullable=True)
    eligible_voters = Column(Integer, nullable=True)
    age_distribution = Column(JSONB, nullable=True, comment='{"18-29": 15.2, "30-39": 18.1, ...}')
    gender_ratio = Column(JSONB, nullable=True, comment='{"male": 49.5, "female": 50.5}')

    __table_args__ = (
        UniqueConstraint("region_sido", "region_sigungu", "data_year", name="uq_demo_region_year"),
    )


class PoliticalContext(Base):
    """정치 환경 데이터 — 대통령 지지율, 여당/야당 지지율."""
    __tablename__ = "political_context"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=True)

    data_date = Column(Date, nullable=False)
    president_approval = Column(Float, nullable=True, comment="대통령 지지율")
    ruling_party_support = Column(Float, nullable=True, comment="여당 지지율")
    opposition_party_support = Column(Float, nullable=True, comment="야당 지지율")
    source = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_political_date", "data_date"),
    )


class EarlyVoting(Base):
    """사전투표 데이터."""
    __tablename__ = "early_voting"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=True)

    election_number = Column(Integer, nullable=False)
    election_type = Column(String(50), nullable=False)
    election_year = Column(Integer, nullable=False)
    region_sido = Column(String(50), nullable=False)
    region_sigungu = Column(String(50), nullable=True)

    eligible_voters = Column(Integer, nullable=True)
    early_voters = Column(Integer, nullable=True)
    early_rate = Column(Float, nullable=True, comment="사전투표율 %")
    election_day_rate = Column(Float, nullable=True, comment="선거일 투표율 %")
    total_rate = Column(Float, nullable=True, comment="최종 투표율 %")

    __table_args__ = (
        Index("ix_early_election", "election_number", "election_type"),
    )


class ElectionEvent(Base):
    """선거 이벤트 타임라인."""
    __tablename__ = "election_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)

    event_date = Column(Date, nullable=False)
    event_type = Column(String(50), nullable=False, comment="debate|announcement|controversy|rally|media|poll|other")
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    candidate_name = Column(String(100), nullable=True, comment="관련 후보 (null=전체)")
    importance = Column(String(20), default="medium", comment="high|medium|low")
    impact_on_polls = Column(Text, nullable=True, comment="여론 영향 분석")

    created_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_events_tenant", "tenant_id", "event_date"),
    )


class AIRecommendation(Base):
    """AI 추천 (전략/경고/기회)."""
    __tablename__ = "ai_recommendations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)

    rec_type = Column(String(30), nullable=False, comment="strategy|warning|opportunity|fact_check")
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=False)
    priority = Column(String(10), default="medium", comment="high|medium|low")
    source = Column(String(100), nullable=True, comment="news_spike|sentiment_drop|trend_change|...")

    status = Column(String(20), default="pending", comment="pending|approved|rejected|dismissed")
    user_response = Column(Text, nullable=True)
    responded_at = Column(DateTime(timezone=True), nullable=True)

    data = Column(JSONB, nullable=True, comment="관련 데이터 (JSON)")
    created_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_rec_tenant", "tenant_id", "status"),
    )


class NewsComment(Base):
    """뉴스 기사 댓글."""
    __tablename__ = "news_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    article_url = Column(String(1000), nullable=False)

    author = Column(String(200), nullable=True)
    text = Column(Text, nullable=False)
    sympathy_count = Column(Integer, default=0, comment="공감 수")
    antipathy_count = Column(Integer, default=0, comment="비공감 수")
    sentiment = Column(String(20), nullable=True)
    candidate_name = Column(String(100), nullable=True)

    published_at = Column(DateTime(timezone=True), nullable=True)
    collected_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_newscomments_article", "article_url"),
        Index("ix_newscomments_tenant", "tenant_id"),
    )


class YouTubeComment(Base):
    """유튜브 댓글."""
    __tablename__ = "youtube_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    video_id = Column(String(20), nullable=False)

    comment_id = Column(String(50), nullable=True)
    author = Column(String(200), nullable=True)
    text = Column(Text, nullable=False)
    like_count = Column(Integer, default=0)
    sentiment = Column(String(20), nullable=True)
    candidate_name = Column(String(100), nullable=True)

    published_at = Column(DateTime(timezone=True), nullable=True)
    collected_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_ytcomments_video", "video_id"),
        Index("ix_ytcomments_tenant", "tenant_id"),
    )


class SNSPost(Base):
    """SNS 게시물 (인스타/페이스북/틱톡/X)."""
    __tablename__ = "sns_posts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=True)

    platform = Column(String(30), nullable=False, comment="instagram|facebook|tiktok|twitter")
    post_id = Column(String(100), nullable=True)
    author = Column(String(200), nullable=True)
    content = Column(Text, nullable=True)
    url = Column(String(1000), nullable=True)

    candidate_name = Column(String(100), nullable=True)
    sentiment = Column(String(20), nullable=True)

    like_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)
    share_count = Column(Integer, default=0)
    view_count = Column(Integer, default=0)
    hashtags = Column(JSONB, default=list)

    published_at = Column(DateTime(timezone=True), nullable=True)
    collected_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_sns_tenant", "tenant_id", "platform"),
    )


class RegionalIssue(Base):
    """지역 이슈 트래킹."""
    __tablename__ = "regional_issues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    region = Column(String(100), nullable=False)
    issue_category = Column(String(100), nullable=False)
    title = Column(String(300), nullable=False)
    source_type = Column(String(30), nullable=True, comment="news|community|youtube")
    source_url = Column(String(1000), nullable=True)
    sentiment = Column(String(20), nullable=True)
    mention_count = Column(Integer, default=1)

    collected_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_regional_tenant", "tenant_id", "region"),
    )


class AnalysisCache(Base):
    """분석 결과 캐싱 (무거운 분석 결과 저장)."""
    __tablename__ = "analysis_cache"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    analysis_type = Column(String(100), nullable=False, comment="share_of_voice|sentiment_battle|...")
    analysis_date = Column(Date, nullable=False)
    period_days = Column(Integer, default=7)
    result_data = Column(JSONB, nullable=False)

    created_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "analysis_type", "analysis_date", "period_days", name="uq_analysis_cache"),
    )


class ImportLog(Base):
    """데이터 임포트 기록."""
    __tablename__ = "import_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    file_name = Column(String(300), nullable=False)
    file_type = Column(String(20), nullable=False, comment="xlsx|csv|pdf|docx")
    data_category = Column(String(50), nullable=True, comment="survey|turnout|early_voting|results|...")
    records_imported = Column(Integer, default=0)
    status = Column(String(20), default="success", comment="success|failed|partial")
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
