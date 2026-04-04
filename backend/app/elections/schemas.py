"""
ElectionPulse - Election & Candidate Schemas
"""
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, field_validator


class ElectionCreate(BaseModel):
    """선거 생성 요청."""
    name: str
    election_type: str  # presidential|congressional|governor|mayor|superintendent|council
    region_sido: Optional[str] = None
    region_sigungu: Optional[str] = None
    election_date: date

    @field_validator("election_type")
    @classmethod
    def valid_type(cls, v):
        allowed = {"presidential", "congressional", "governor", "mayor", "superintendent", "council", "other"}
        if v not in allowed:
            raise ValueError(f"유효한 선거 유형: {', '.join(allowed)}")
        return v


class ElectionUpdate(BaseModel):
    """선거 수정 요청."""
    name: Optional[str] = None
    election_date: Optional[date] = None
    region_sido: Optional[str] = None
    region_sigungu: Optional[str] = None
    is_active: Optional[bool] = None
    our_candidate_id: Optional[str] = None


class ElectionResponse(BaseModel):
    """선거 응답."""
    id: str
    name: str
    election_type: str
    region_sido: Optional[str]
    region_sigungu: Optional[str]
    election_date: date
    is_active: bool
    our_candidate_id: Optional[str]
    d_day: int
    candidates_count: int = 0
    keywords_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class CandidateCreate(BaseModel):
    """후보자 추가 요청 (고객이 직접 추가 가능)."""
    name: str
    party: Optional[str] = None
    party_alignment: Optional[str] = None
    role: Optional[str] = None
    is_our_candidate: bool = False
    search_keywords: list[str] = []
    homonym_filters: list[str] = []
    sns_links: dict = {}
    career_summary: Optional[str] = None

    @field_validator("party_alignment")
    @classmethod
    def valid_alignment(cls, v):
        if v and v not in {"conservative", "progressive", "centrist", "independent"}:
            raise ValueError("유효한 성향: conservative, progressive, centrist, independent")
        return v


class CandidateUpdate(BaseModel):
    """후보자 수정 요청."""
    name: Optional[str] = None
    party: Optional[str] = None
    party_alignment: Optional[str] = None
    role: Optional[str] = None
    is_our_candidate: Optional[bool] = None
    search_keywords: Optional[list[str]] = None
    homonym_filters: Optional[list[str]] = None
    sns_links: Optional[dict] = None
    career_summary: Optional[str] = None
    enabled: Optional[bool] = None


class CandidateResponse(BaseModel):
    """후보자 응답."""
    id: str
    name: str
    party: Optional[str]
    party_alignment: Optional[str]
    role: Optional[str]
    is_our_candidate: bool
    enabled: bool
    search_keywords: list[str]
    homonym_filters: list[str]
    sns_links: dict
    career_summary: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class KeywordCreate(BaseModel):
    """키워드 추가."""
    word: str
    category: str = "custom"
    candidate_id: Optional[str] = None


class KeywordResponse(BaseModel):
    """키워드 응답."""
    id: str
    word: str
    category: str
    candidate_id: Optional[str]
    enabled: bool

    model_config = {"from_attributes": True}


class ScheduleConfigCreate(BaseModel):
    """스케줄 설정 생성."""
    name: str
    schedule_type: str
    fixed_times: list[str] = []
    cron_expression: Optional[str] = None
    enabled: bool = True
    config: dict = {}


class ScheduleConfigResponse(BaseModel):
    """스케줄 설정 응답."""
    id: str
    name: str
    schedule_type: str
    fixed_times: list[str]
    cron_expression: Optional[str]
    enabled: bool
    config: dict

    model_config = {"from_attributes": True}
