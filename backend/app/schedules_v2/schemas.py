"""
schedules_v2 — Pydantic schemas
"""
from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


ScheduleCategory = Literal[
    'rally', 'street', 'debate', 'broadcast', 'interview',
    'meeting', 'supporter', 'voting', 'internal', 'other',
]
ScheduleVisibility = Literal['public', 'internal']
ScheduleStatus = Literal['planned', 'in_progress', 'done', 'canceled']
ResultMood = Literal['good', 'normal', 'bad']


class ScheduleCreate(BaseModel):
    candidate_id: UUID
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    location: Optional[str] = Field(None, max_length=300)
    starts_at: datetime
    ends_at: datetime
    all_day: bool = False
    category: ScheduleCategory = 'other'
    visibility: Optional[ScheduleVisibility] = None  # None = 캠프 기본값 따름
    recurrence_rule: Optional[str] = None  # RRULE 문자열

    @field_validator('ends_at')
    @classmethod
    def ends_after_starts(cls, v, info):
        starts = info.data.get('starts_at')
        if starts and v < starts:
            raise ValueError('ends_at must be >= starts_at')
        return v


class ScheduleUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    location: Optional[str] = Field(None, max_length=300)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    all_day: Optional[bool] = None
    category: Optional[ScheduleCategory] = None
    visibility: Optional[ScheduleVisibility] = None
    status: Optional[ScheduleStatus] = None
    recurrence_rule: Optional[str] = None


class ScheduleResultInput(BaseModel):
    result_mood: Optional[ResultMood] = None
    result_summary: Optional[str] = None
    attended_count: Optional[int] = Field(None, ge=0)


class ScheduleOut(BaseModel):
    id: UUID
    election_id: UUID
    candidate_id: UUID
    candidate_name: Optional[str] = None
    tenant_id: UUID

    title: str
    description: Optional[str] = None

    location: Optional[str] = None
    location_url: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    admin_sido: Optional[str] = None
    admin_sigungu: Optional[str] = None
    admin_dong: Optional[str] = None
    admin_ri: Optional[str] = None

    starts_at: datetime
    ends_at: datetime
    all_day: bool

    category: ScheduleCategory
    visibility: ScheduleVisibility
    status: ScheduleStatus

    result_summary: Optional[str] = None
    result_mood: Optional[str] = None
    attended_count: Optional[int] = None
    media_coverage: list = []

    recurrence_rule: Optional[str] = None
    parent_schedule_id: Optional[UUID] = None
    source_input_id: Optional[UUID] = None

    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ─── 자연어 파싱 ─────────────────────────────────────────────────────────

class ParseRequest(BaseModel):
    """자연어 입력 파싱 요청."""
    text: str = Field(..., min_length=1, max_length=4000)
    candidate_id: UUID  # 어느 후보에 귀속될지
    mode: Literal['single', 'multi', 'auto'] = 'auto'  # auto = 줄바꿈 여러 개면 multi
    default_date: Optional[str] = None  # "2026-04-22" — 시간만 있는 항목 기준일


class ParsedSchedule(BaseModel):
    """AI가 파싱한 일정 한 건 (저장 전 확인용)."""
    title: str
    description: Optional[str] = None
    location: Optional[str] = None
    starts_at: datetime
    ends_at: datetime
    all_day: bool = False
    category: ScheduleCategory = 'other'
    recurrence_rule: Optional[str] = None
    confidence: float = Field(0.9, ge=0.0, le=1.0)
    warnings: list[str] = []


class ParseResponse(BaseModel):
    parsed: list[ParsedSchedule]
    raw_ai_text: Optional[str] = None
    overall_confidence: float
