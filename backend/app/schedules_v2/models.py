"""
schedules_v2 — ORM
마이그레이션: backend/migrations/2026_04_21_candidate_schedules.sql
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, DateTime, Float, ForeignKey, Index, Integer,
    String, Text, Boolean,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, ENUM as PGEnum

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


# PGEnum create_type=False: DB 마이그레이션에서 이미 생성한 타입 사용
schedule_category_enum = PGEnum(
    'rally', 'street', 'debate', 'broadcast', 'interview',
    'meeting', 'supporter', 'voting', 'internal', 'other',
    name='schedule_category', create_type=False,
)
schedule_visibility_enum = PGEnum(
    'public', 'internal',
    name='schedule_visibility', create_type=False,
)
schedule_status_enum = PGEnum(
    'planned', 'in_progress', 'done', 'canceled',
    name='schedule_status', create_type=False,
)


class CandidateSchedule(Base):
    __tablename__ = "candidate_schedules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    election_id = Column(UUID(as_uuid=True), ForeignKey("elections.id", ondelete="CASCADE"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)

    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)

    location = Column(String(300), nullable=True)
    location_url = Column(Text, nullable=True)
    location_lat = Column(Float, nullable=True)
    location_lng = Column(Float, nullable=True)
    admin_sido = Column(String(30), nullable=True)
    admin_sigungu = Column(String(50), nullable=True)
    admin_dong = Column(String(50), nullable=True)
    admin_ri = Column(String(50), nullable=True)

    starts_at = Column(DateTime(timezone=True), nullable=False)
    ends_at = Column(DateTime(timezone=True), nullable=False)
    all_day = Column(Boolean, nullable=False, default=False)

    category = Column(schedule_category_enum, nullable=False, default='other')
    visibility = Column(schedule_visibility_enum, nullable=False, default='internal')
    status = Column(schedule_status_enum, nullable=False, default='planned')

    result_summary = Column(Text, nullable=True)
    result_mood = Column(String(10), nullable=True)  # good|normal|bad
    attended_count = Column(Integer, nullable=True)
    media_coverage = Column(JSONB, nullable=False, default=list)

    recurrence_rule = Column(Text, nullable=True)
    parent_schedule_id = Column(
        UUID(as_uuid=True),
        ForeignKey("candidate_schedules.id", ondelete="CASCADE"),
        nullable=True,
    )

    source_input_id = Column(UUID(as_uuid=True), nullable=True)

    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
