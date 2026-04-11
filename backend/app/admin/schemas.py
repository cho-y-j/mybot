"""Admin API Pydantic 스키마 공통 정의."""
from typing import Optional
from pydantic import BaseModel


class ApprovalNote(BaseModel):
    note: Optional[str] = None


class TenantCreateReq(BaseModel):
    name: str
    plan: str = "basic"
    max_elections: int = 1
    max_members: int = 5
    max_candidates: int = 5
    max_keywords: int = 30


class TenantUpdateReq(BaseModel):
    name: Optional[str] = None
    plan: Optional[str] = None
    max_elections: Optional[int] = None
    max_members: Optional[int] = None
    max_candidates: Optional[int] = None
    max_keywords: Optional[int] = None
    is_active: Optional[bool] = None


class TenantUserCreateReq(BaseModel):
    email: str
    password: str
    name: str
    phone: Optional[str] = None
    role: str = "admin"


class PasswordChangeReq(BaseModel):
    new_password: str


class AIAccountCreate(BaseModel):
    provider: str  # claude | chatgpt
    name: str
    config_dir: Optional[str] = None
    notes: Optional[str] = None


class AIAccountUpdate(BaseModel):
    name: Optional[str] = None
    config_dir: Optional[str] = None
    status: Optional[str] = None  # active | blocked | inactive
    priority: Optional[int] = None
    notes: Optional[str] = None


class TenantAPIKeyUpdate(BaseModel):
    anthropic_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
