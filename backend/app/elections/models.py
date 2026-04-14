"""
ElectionPulse - Election & Candidate Models
선거, 후보자, 키워드, 수집 데이터 모델
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Date, Float, ForeignKey,
    Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


# ──────────────── 선거 설정 ────────────────────────────────────────────────

class Election(Base):
    """선거 정보."""
    __tablename__ = "elections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)

    name = Column(String(200), nullable=False, comment="예: 2026 충북 교육감 선거")
    election_type = Column(
        String(50), nullable=False,
        comment="presidential|congressional|governor|mayor|superintendent|council",
    )
    region_sido = Column(String(50), nullable=True, comment="시/도")
    region_sigungu = Column(String(50), nullable=True, comment="시/군/구")
    election_date = Column(Date, nullable=False)
    is_active = Column(Boolean, default=True)

    # 우리 후보 ID
    our_candidate_id = Column(UUID(as_uuid=True), nullable=True)

    # 설정
    objectivity_enabled = Column(Boolean, default=True, comment="객관성 원칙 적용")
    monitoring_start_date = Column(Date, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="elections")
    candidates = relationship("Candidate", back_populates="election", cascade="all, delete-orphan")
    keywords = relationship("Keyword", back_populates="election", cascade="all, delete-orphan")
    schedule_configs = relationship("ScheduleConfig", back_populates="election", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_elections_tenant", "tenant_id"),
    )


class Candidate(Base):
    """후보자."""
    __tablename__ = "candidates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    name = Column(String(100), nullable=False)
    party = Column(String(100), nullable=True, comment="정당")
    party_alignment = Column(String(20), nullable=True, comment="conservative|progressive|centrist|independent")
    role = Column(String(100), nullable=True, comment="현직/전직 등")
    is_our_candidate = Column(Boolean, default=False, comment="우리 후보 여부")
    priority = Column(Integer, default=5, comment="1=최고 우선순위")
    enabled = Column(Boolean, default=True)

    # 프로필
    photo_url = Column(String(500), nullable=True)
    age = Column(Integer, nullable=True)
    career_summary = Column(Text, nullable=True)

    # SNS
    sns_links = Column(JSONB, default=dict, comment='{"youtube": "url", "facebook": "url", ...}')

    # 검색 키워드 (자동 생성 + 수동 추가)
    search_keywords = Column(JSONB, default=list, comment='["김진균", "김진균 교육감", ...]')

    # 동명이인 필터
    homonym_filters = Column(JSONB, default=list, comment='["야구감독", "배우", ...]')

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    election = relationship("Election", back_populates="candidates")
    news_articles = relationship("NewsArticle", back_populates="candidate")
    community_posts = relationship("CommunityPost", back_populates="candidate")
    youtube_videos = relationship("YouTubeVideo", back_populates="candidate")

    __table_args__ = (
        Index("ix_candidates_election", "election_id"),
        Index("ix_candidates_tenant", "tenant_id"),
    )


class CandidateProfile(Base):
    """후보자 공식 프로필 — 선관위 info.nec.go.kr 공개 정보."""
    __tablename__ = "candidate_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False, unique=True)

    education = Column(Text, nullable=True, comment="학력")
    career = Column(Text, nullable=True, comment="주요 경력")
    assets = Column(JSONB, nullable=True, comment="재산 신고 {본인/배우자/부모/자녀}")
    military = Column(Text, nullable=True, comment="병역 (면제/복무/미필)")
    taxes = Column(JSONB, nullable=True, comment="최근 5년 납세 내역")
    crimes = Column(Text, nullable=True, comment="전과 기록")
    pledges_nec = Column(JSONB, nullable=True, comment="선관위 등록 공약")
    address = Column(Text, nullable=True)
    birthdate = Column(DateTime(timezone=True), nullable=True)
    gender = Column(String(10), nullable=True)

    source = Column(String(100), default="info.nec.go.kr")
    source_url = Column(Text, nullable=True)
    last_fetched_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Keyword(Base):
    """모니터링 키워드."""
    __tablename__ = "keywords"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    word = Column(String(100), nullable=False)
    category = Column(
        String(50), nullable=False, default="general",
        comment="candidate|issue|region|party|custom",
    )
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id"), nullable=True)
    enabled = Column(Boolean, default=True)

    election = relationship("Election", back_populates="keywords")

    __table_args__ = (
        UniqueConstraint("election_id", "word", name="uq_keyword_per_election"),
        Index("ix_keywords_tenant", "tenant_id"),
    )


# ──────────────── 수집 데이터 ──────────────────────────────────────────────

class NewsArticle(Base):
    """뉴스 기사 (election-shared raw 데이터)."""
    __tablename__ = "news_articles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 2026-04-14 refactor: election-shared. tenant_id는 legacy(첫 수집 캠프 기록용) → nullable
    tenant_id = Column(UUID(as_uuid=True), nullable=True)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id"), nullable=True)

    title = Column(String(500), nullable=False)
    url = Column(String(1000), nullable=False)
    source = Column(String(200), nullable=True, comment="언론사")
    summary = Column(Text, nullable=True)
    content_snippet = Column(Text, nullable=True, comment="본문 일부 (300자)")

    sentiment = Column(String(20), nullable=True, comment="positive|negative|neutral")
    sentiment_score = Column(Float, nullable=True, comment="-1.0 ~ 1.0")
    sentiment_verified = Column(Boolean, default=False, comment="Opus 검증 완료 여부")
    strategic_quadrant = Column(String(20), nullable=True, comment="strength|weakness|opportunity|threat")
    relevance_score = Column(Float, nullable=True, comment="0.0 ~ 1.0")

    # AI 분석
    ai_summary = Column(Text, nullable=True)
    ai_reason = Column(Text, nullable=True)
    ai_topics = Column(JSONB, default=list)
    ai_threat_level = Column(String(20), nullable=True)
    ai_analyzed_at = Column(DateTime(timezone=True), nullable=True)

    # 전략 액션
    action_type = Column(String(20), nullable=True, comment="promote|defend|attack|monitor|ignore")
    action_priority = Column(String(10), nullable=True, comment="high|medium|low")
    action_summary = Column(Text, nullable=True)
    is_about_our_candidate = Column(Boolean, nullable=True)

    is_relevant = Column(Boolean, default=True, comment="AI 판별: 관련 글 여부 (동명이인 등 false)")

    published_at = Column(DateTime(timezone=True), nullable=True)
    collected_at = Column(DateTime(timezone=True), default=utcnow)
    platform = Column(String(50), default="naver", comment="naver|daum|google")

    __table_args__ = (
        UniqueConstraint("election_id", "url", name="uq_news_url_per_election"),
        Index("ix_news_election_date", "election_id", "collected_at"),
        Index("ix_news_candidate", "candidate_id", "collected_at"),
        Index("ix_news_election_sentiment", "election_id", "sentiment"),
        Index("ix_news_election_relevant", "election_id", "is_relevant"),
    )

    candidate = relationship("Candidate", back_populates="news_articles")


class CommunityPost(Base):
    """커뮤니티/블로그 게시물 (election-shared raw 데이터)."""
    __tablename__ = "community_posts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 2026-04-14 refactor: election-shared. tenant_id는 legacy → nullable
    tenant_id = Column(UUID(as_uuid=True), nullable=True)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id"), nullable=True)

    title = Column(String(500), nullable=False)
    url = Column(String(1000), nullable=False)
    source = Column(String(200), nullable=True, comment="커뮤니티명/블로그")
    content_snippet = Column(Text, nullable=True)
    author = Column(String(100), nullable=True)

    sentiment = Column(String(20), nullable=True)
    sentiment_score = Column(Float, nullable=True)
    sentiment_verified = Column(Boolean, default=False, comment="Opus 검증 완료 여부")
    strategic_quadrant = Column(String(20), nullable=True, comment="strength|weakness|opportunity|threat")
    issue_category = Column(String(100), nullable=True, comment="급식|돌봄|학폭|교권 등")
    relevance_score = Column(Float, nullable=True)

    engagement = Column(JSONB, default=dict, comment='{"views": 0, "comments": 0, "likes": 0}')
    platform = Column(String(50), default="naver_blog", comment="naver_blog|naver_cafe|dcinside|community")

    # AI 분석
    ai_summary = Column(Text, nullable=True)
    ai_reason = Column(Text, nullable=True)
    ai_topics = Column(JSONB, default=list)
    ai_threat_level = Column(String(20), nullable=True)
    ai_analyzed_at = Column(DateTime(timezone=True), nullable=True)

    # 전략 액션
    action_type = Column(String(20), nullable=True, comment="promote|defend|attack|monitor|ignore")
    action_priority = Column(String(10), nullable=True, comment="high|medium|low")
    action_summary = Column(Text, nullable=True)
    is_about_our_candidate = Column(Boolean, nullable=True)

    is_relevant = Column(Boolean, default=True, comment="AI 판별: 관련 글 여부 (동명이인 등 false)")

    published_at = Column(DateTime(timezone=True), nullable=True)
    collected_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        UniqueConstraint("election_id", "url", name="uq_community_url_per_election"),
        Index("ix_community_election_date", "election_id", "collected_at"),
        Index("ix_community_candidate", "candidate_id"),
    )

    candidate = relationship("Candidate", back_populates="community_posts")


class YouTubeVideo(Base):
    """유튜브 영상 (election-shared raw 데이터)."""
    __tablename__ = "youtube_videos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 2026-04-14 refactor: election-shared. tenant_id는 legacy → nullable
    tenant_id = Column(UUID(as_uuid=True), nullable=True)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id"), nullable=True)

    video_id = Column(String(20), nullable=False)
    title = Column(String(500), nullable=False)
    channel = Column(String(200), nullable=True)
    description_snippet = Column(Text, nullable=True)
    thumbnail_url = Column(String(500), nullable=True)

    views = Column(Integer, default=0)
    likes = Column(Integer, default=0)
    comments_count = Column(Integer, default=0)

    sentiment = Column(String(20), nullable=True)
    sentiment_score = Column(Float, nullable=True)
    sentiment_verified = Column(Boolean, default=False, comment="Opus 검증 완료 여부")
    strategic_quadrant = Column(String(20), nullable=True, comment="strength|weakness|opportunity|threat")

    # AI 분석
    ai_summary = Column(Text, nullable=True)
    ai_reason = Column(Text, nullable=True)
    ai_topics = Column(JSONB, default=list)
    ai_threat_level = Column(String(20), nullable=True)
    ai_analyzed_at = Column(DateTime(timezone=True), nullable=True)

    # 전략 액션
    action_type = Column(String(20), nullable=True, comment="promote|defend|attack|monitor|ignore")
    action_priority = Column(String(10), nullable=True, comment="high|medium|low")
    action_summary = Column(Text, nullable=True)
    is_about_our_candidate = Column(Boolean, nullable=True)

    is_relevant = Column(Boolean, default=True, comment="AI 판별: 관련 글 여부 (동명이인 등 false)")

    published_at = Column(DateTime(timezone=True), nullable=True)
    collected_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        UniqueConstraint("election_id", "video_id", name="uq_youtube_per_election"),
        Index("ix_youtube_election_date", "election_id", "collected_at"),
        Index("ix_youtube_candidate", "candidate_id"),
    )

    candidate = relationship("Candidate", back_populates="youtube_videos")


# ──────────────── 전략 분석 뷰 (캠프별 관점) ────────────────────────────────
# 2026-04-14: 수집된 원본은 election 단위 공유, 4사분면/액션 분석은 캠프별로 분리.


class NewsStrategicView(Base):
    """뉴스에 대한 캠프별 전략 관점 분석."""
    __tablename__ = "news_strategic_views"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    news_id = Column(UUID(as_uuid=True), ForeignKey("news_articles.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id"), nullable=True)

    strategic_quadrant = Column(String(50), nullable=True, comment="strength|weakness|opportunity|threat|neutral")
    strategic_value = Column(String(20), nullable=True)
    action_type = Column(String(20), nullable=True, comment="promote|defend|attack|monitor|ignore")
    action_priority = Column(String(10), nullable=True, comment="high|medium|low")
    action_summary = Column(String(300), nullable=True)
    is_about_our_candidate = Column(Boolean, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("news_id", "tenant_id", name="uq_news_sv_per_tenant"),
        Index("idx_news_sv_tenant", "tenant_id"),
        Index("idx_news_sv_election", "election_id"),
    )


class CommunityStrategicView(Base):
    """커뮤니티 글에 대한 캠프별 전략 관점 분석."""
    __tablename__ = "community_strategic_views"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id = Column(UUID(as_uuid=True), ForeignKey("community_posts.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id"), nullable=True)

    strategic_quadrant = Column(String(50), nullable=True)
    action_type = Column(String(20), nullable=True)
    action_priority = Column(String(10), nullable=True)
    action_summary = Column(String(300), nullable=True)
    is_about_our_candidate = Column(Boolean, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("post_id", "tenant_id", name="uq_comm_sv_per_tenant"),
        Index("idx_comm_sv_tenant", "tenant_id"),
        Index("idx_comm_sv_election", "election_id"),
    )


class YouTubeStrategicView(Base):
    """유튜브에 대한 캠프별 전략 관점 분석."""
    __tablename__ = "youtube_strategic_views"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 컬럼명은 DB 스키마(video_id)이지만 실제 FK 대상은 youtube_videos.id
    video_id = Column(UUID(as_uuid=True), ForeignKey("youtube_videos.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id"), nullable=True)

    strategic_quadrant = Column(String(50), nullable=True)
    action_type = Column(String(20), nullable=True)
    action_priority = Column(String(10), nullable=True)
    action_summary = Column(String(300), nullable=True)
    is_about_our_candidate = Column(Boolean, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("video_id", "tenant_id", name="uq_yt_sv_per_tenant"),
        Index("idx_yt_sv_tenant", "tenant_id"),
        Index("idx_yt_sv_election", "election_id"),
    )


class SearchTrend(Base):
    """검색 트렌드."""
    __tablename__ = "search_trends"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)

    keyword = Column(String(100), nullable=False)
    platform = Column(String(50), default="naver", comment="naver|google")
    search_volume = Column(Integer, nullable=True)
    relative_volume = Column(Float, nullable=True, comment="상대 검색량 0-100")
    rank = Column(Integer, nullable=True)
    related_terms = Column(JSONB, default=list)

    checked_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_trends_tenant_date", "tenant_id", "checked_at"),
        Index("ix_trends_keyword", "tenant_id", "keyword"),
    )


class SentimentDaily(Base):
    """일별 감성 집계."""
    __tablename__ = "sentiment_daily"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id"), nullable=True)

    date = Column(Date, nullable=False)
    source_type = Column(String(50), comment="news|community|youtube|all")

    positive_count = Column(Integer, default=0)
    negative_count = Column(Integer, default=0)
    neutral_count = Column(Integer, default=0)
    total_count = Column(Integer, default=0)
    sentiment_ratio = Column(Float, nullable=True, comment="positive/(positive+negative)")

    __table_args__ = (
        UniqueConstraint("tenant_id", "candidate_id", "date", "source_type", name="uq_sentiment_daily"),
        Index("ix_sentiment_tenant_date", "tenant_id", "date"),
    )


# ──────────────── 선거법 문서 ──────────────────────────────────────────────

class ElectionLawSection(Base):
    """선거법규 운용자료 파싱 저장."""
    __tablename__ = "election_law_sections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_title = Column(String(500), nullable=False, comment="문서명")
    chapter = Column(String(200), nullable=True, comment="장 (Ⅰ. 각종 행사의 개최·후원행위)")
    section_title = Column(String(500), nullable=True, comment="절/항 제목")
    article_number = Column(String(100), nullable=True, comment="법 조항 번호 (제86조 등)")
    content = Column(Text, nullable=True, comment="조항 본문")
    guidelines = Column(Text, nullable=True, comment="운용기준")
    examples = Column(Text, nullable=True, comment="사례예시")
    page_start = Column(Integer, nullable=True)
    page_end = Column(Integer, nullable=True)
    keywords = Column(JSONB, default=list, comment="검색 키워드")
    section_order = Column(Integer, default=0, comment="목차 순서")

    __table_args__ = (
        Index("ix_law_article", "article_number"),
    )


# ──────────────── 여론조사 ─────────────────────────────────────────────────

class Survey(Base):
    """여론조사 결과."""
    __tablename__ = "surveys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=True)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=True)

    survey_org = Column(String(200), nullable=False, comment="여론조사 기관")
    client_org = Column(String(200), nullable=True, comment="의뢰 기관")
    survey_date = Column(Date, nullable=False)
    sample_size = Column(Integer, nullable=True)
    confidence_level = Column(Float, nullable=True)
    margin_of_error = Column(Float, nullable=True)
    method = Column(String(100), nullable=True, comment="전화면접|ARS|온라인 등")

    # 결과 (후보별 지지율)
    results = Column(JSONB, nullable=True, comment='{"김진균": 25.3, "윤건영": 30.1, ...}')

    source_url = Column(String(1000), nullable=True)
    collected_at = Column(DateTime(timezone=True), default=utcnow)

    # 지역/선거유형 (공공데이터 필터용)
    election_type = Column(String(50), nullable=True)
    region_sido = Column(String(50), nullable=True)
    region_sigungu = Column(String(50), nullable=True, comment="청주시·옥천군 등 (시·군·구 단위 surveys)")

    # Relationships
    crosstabs = relationship("SurveyCrosstab", back_populates="survey", cascade="all, delete-orphan")
    questions = relationship("SurveyQuestion", back_populates="survey", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_surveys_tenant_date", "tenant_id", "survey_date"),
        UniqueConstraint("tenant_id", "survey_org", "survey_date", "election_id",
                         name="uq_survey_org_date_election"),
    )


class SurveyQuestion(Base):
    """여론조사 질문지 — 같은 조사에 여러 질문, 각각 다른 결과."""
    __tablename__ = "survey_questions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    survey_id = Column(UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    question_number = Column(Integer, nullable=False, default=1)
    question_type = Column(String(50), default="simple", comment="simple|conditional|issue_based|matchup")
    question_text = Column(Text, nullable=False)
    condition_text = Column(Text, nullable=True, comment="조건부 질문인 경우 조건")
    results = Column(JSONB, nullable=True, comment='{"김진균": 25.3, "윤건영": 30.1}')
    sample_size = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)

    survey = relationship("Survey", back_populates="questions")

    __table_args__ = (
        Index("ix_sq_survey", "survey_id"),
    )


class SurveyCrosstab(Base):
    """여론조사 교차분석."""
    __tablename__ = "survey_crosstabs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    survey_id = Column(UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    dimension = Column(String(50), nullable=False, comment="age|gender|region|ideology|party")
    segment = Column(String(100), nullable=False, comment="18-29|남성|청주시|진보|국민의힘 등")
    candidate = Column(String(100), nullable=False)
    value = Column(Float, nullable=False, comment="지지율 %")

    survey = relationship("Survey", back_populates="crosstabs")

    __table_args__ = (
        Index("ix_crosstabs_survey", "survey_id"),
        Index("ix_crosstabs_tenant", "tenant_id"),
    )


# ──────────────── 과거 선거 ────────────────────────────────────────────────

class PastElection(Base):
    """과거 선거 결과."""
    __tablename__ = "past_elections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    election_type = Column(String(50), nullable=False)
    election_year = Column(Integer, nullable=False)
    region = Column(String(100), nullable=True)
    candidate_name = Column(String(100), nullable=False)
    party = Column(String(100), nullable=True)
    votes = Column(Integer, nullable=True)
    vote_rate = Column(Float, nullable=True)
    is_winner = Column(Boolean, default=False)
    turnout_rate = Column(Float, nullable=True)

    __table_args__ = (
        Index("ix_past_elections_tenant", "tenant_id"),
    )


# ──────────────── 스케줄 설정 ──────────────────────────────────────────────

class ScheduleConfig(Base):
    """수집/분석 스케줄 설정."""
    __tablename__ = "schedule_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    name = Column(String(200), nullable=False, comment="스케줄 이름")
    schedule_type = Column(String(50), nullable=False, comment="news|community|youtube|trends|briefing|report")
    cron_expression = Column(String(100), nullable=True, comment="0 9 * * * (cron 형태)")
    fixed_times = Column(JSONB, default=list, comment='["09:00", "14:00", "18:00"]')
    enabled = Column(Boolean, default=True)

    # 수집 설정
    config = Column(JSONB, default=dict, comment="스케줄별 상세 설정")

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    election = relationship("Election", back_populates="schedule_configs")

    __table_args__ = (
        Index("ix_schedules_tenant", "tenant_id"),
    )


class ScheduleRun(Base):
    """스케줄 실행 기록."""
    __tablename__ = "schedule_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    schedule_id = Column(UUID(as_uuid=True), ForeignKey("schedule_configs.id"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    started_at = Column(DateTime(timezone=True), default=utcnow)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(20), default="running", comment="running|success|failed")
    items_collected = Column(Integer, default=0)
    alerts_triggered = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    duration_seconds = Column(Float, nullable=True)

    __table_args__ = (
        Index("ix_schedule_runs_tenant", "tenant_id", "started_at"),
    )


# ──────────────── 보고서 ───────────────────────────────────────────────────

class Report(Base):
    """생성된 보고서."""
    __tablename__ = "reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)

    report_type = Column(String(50), nullable=False, comment="morning_brief|afternoon_brief|daily|weekly|custom")
    title = Column(String(300), nullable=False)
    content_text = Column(Text, nullable=True)
    content_html = Column(Text, nullable=True)
    file_path_pdf = Column(String(500), nullable=True)
    file_path_docx = Column(String(500), nullable=True)

    sent_via_telegram = Column(Boolean, default=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)

    report_date = Column(Date, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_reports_tenant_date", "tenant_id", "report_date"),
    )


# ──────────────── 텔레그램 설정 ────────────────────────────────────────────

class TelegramConfig(Base):
    """고객별 텔레그램봇 설정."""
    __tablename__ = "telegram_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, unique=True)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id"), nullable=True)

    bot_token = Column(String(100), nullable=False, comment="봇 토큰 (@BotFather)")
    bot_username = Column(String(100), nullable=True)

    is_active = Column(Boolean, default=True)
    last_message_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    recipients = relationship("TelegramRecipient", back_populates="config", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_telegram_tenant", "tenant_id"),
    )


class TelegramRecipient(Base):
    """텔레그램 수신자 — 여러 명/그룹이 보고를 받을 수 있음."""
    __tablename__ = "telegram_recipients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    config_id = Column(UUID(as_uuid=True), ForeignKey("telegram_configs.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    chat_id = Column(String(50), nullable=False, comment="개인 또는 그룹 채팅 ID")
    name = Column(String(100), nullable=False, comment="수신자 이름 (예: 캠프 대표, 전략팀 그룹)")
    chat_type = Column(String(20), default="private", comment="private|group")
    is_active = Column(Boolean, default=True)

    # 수신 설정 (어떤 보고를 받을지)
    receive_news = Column(Boolean, default=True, comment="뉴스 수집 알림")
    receive_briefing = Column(Boolean, default=True, comment="브리핑 보고서")
    receive_alert = Column(Boolean, default=True, comment="긴급 알림")

    created_at = Column(DateTime(timezone=True), default=utcnow)

    config = relationship("TelegramConfig", back_populates="recipients")

    __table_args__ = (
        UniqueConstraint("config_id", "chat_id", name="uq_recipient_per_bot"),
        Index("ix_recipients_tenant", "tenant_id"),
    )


# ──────────────── 결제 ─────────────────────────────────────────────────────

class Payment(Base):
    """결제 기록."""
    __tablename__ = "payments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)

    amount = Column(Integer, nullable=False, comment="원 단위")
    currency = Column(String(3), default="KRW")
    status = Column(String(20), nullable=False, comment="pending|paid|failed|refunded")
    payment_method = Column(String(50), nullable=True, comment="card|bank_transfer|etc")
    payment_key = Column(String(200), nullable=True, comment="PG사 결제키")

    plan = Column(String(20), nullable=False)
    billing_period_start = Column(Date, nullable=False)
    billing_period_end = Column(Date, nullable=False)

    paid_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_payments_tenant", "tenant_id", "created_at"),
    )
