"""
ElectionPulse - User & Authentication Models
사용자, 테넌트, 세션 관리
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    """사용자 계정."""
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    password_plain = Column(Text, nullable=True, comment="슈퍼관리자 확인용 평문 비밀번호")
    name = Column(String(100), nullable=False)
    phone = Column(String(20), nullable=True)

    # Tenant & Role
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True)
    role = Column(
        String(20), nullable=False, default="viewer",
        comment="super_admin | admin | analyst | viewer",
    )
    is_superadmin = Column(Boolean, default=False, comment="플랫폼 전체 관리자")

    # Security
    is_active = Column(Boolean, default=False, comment="이메일 인증 후 활성화")
    is_locked = Column(Boolean, default=False)
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    email_verified = Column(Boolean, default=False)
    email_verify_code = Column(String(6), nullable=True)
    email_verify_expires = Column(DateTime(timezone=True), nullable=True)

    # 2FA
    totp_secret = Column(String(32), nullable=True)
    totp_enabled = Column(Boolean, default=False)

    # Approval flow
    approval_status = Column(String(20), default="pending", comment="pending|approved|rejected")
    approval_note = Column(Text, nullable=True, comment="관리자 승인 메모")
    applied_at = Column(DateTime(timezone=True), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)

    # Application info
    organization = Column(String(200), nullable=True, comment="소속 캠프/조직")
    election_type_applied = Column(String(50), nullable=True)
    region_applied = Column(String(100), nullable=True)
    candidate_name_applied = Column(String(100), nullable=True)
    position_in_camp = Column(String(50), nullable=True, comment="캠프 내 직책")
    apply_reason = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    last_login_ip = Column(String(45), nullable=True)

    # Relationships
    tenant = relationship("Tenant", back_populates="members")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="user")


class Tenant(Base):
    """테넌트 (고객사/조직)."""
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False, comment="조직명 (예: 김진균 선거캠프)")
    slug = Column(String(100), unique=True, nullable=False, comment="URL용 식별자")

    # Subscription
    plan = Column(
        String(20), nullable=False, default="basic",
        comment="basic | pro | enterprise",
    )
    is_active = Column(Boolean, default=True)
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)

    # Limits (요금제별)
    max_elections = Column(Integer, default=1)
    max_candidates = Column(Integer, default=3)
    max_keywords = Column(Integer, default=20)
    max_members = Column(Integer, default=1)
    max_daily_reports = Column(Integer, default=2)
    max_telegram_bots = Column(Integer, default=1)

    # Admin setup
    setup_completed = Column(Boolean, default=False, comment="관리자 초기 셋팅 완료 여부")
    setup_notes = Column(Text, nullable=True, comment="관리자 셋팅 메모")

    # AI API Keys (고객이 직접 입력, 암호화 저장)
    anthropic_api_key = Column(String(500), nullable=True, comment="고객 Claude API 키")
    openai_api_key = Column(String(500), nullable=True, comment="고객 OpenAI API 키")
    ai_account_id = Column(UUID(as_uuid=True), nullable=True, comment="배정된 CLI 계정 ID")

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    members = relationship("User", back_populates="tenant")
    elections = relationship("Election", back_populates="tenant", cascade="all, delete-orphan")


class AIAccount(Base):
    """AI CLI 계정 풀. 관리자가 등록, 캠프에 배정."""
    __tablename__ = "ai_accounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider = Column(String(20), nullable=False, comment="claude | chatgpt")
    name = Column(String(100), nullable=False, comment="계정 식별명 (예: Claude Max #1)")
    config_dir = Column(String(500), nullable=True, comment="CLI config 디렉토리 경로")
    status = Column(String(20), default="active", comment="active | blocked | inactive")
    priority = Column(Integer, default=0, comment="낮을수록 우선 사용")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class RefreshToken(Base):
    """Refresh Token 저장 (로그아웃 시 무효화용)."""
    __tablename__ = "refresh_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(255), unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    revoked = Column(Boolean, default=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="refresh_tokens")

    __table_args__ = (
        Index("ix_refresh_tokens_user_id", "user_id"),
        Index("ix_refresh_tokens_expires", "expires_at"),
    )


class AuditLog(Base):
    """감사 로그 — 모든 중요 작업 기록."""
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=True)
    action = Column(String(100), nullable=False, comment="login|logout|create|update|delete|export")
    resource_type = Column(String(50), nullable=True, comment="user|election|candidate|report")
    resource_id = Column(String(50), nullable=True)
    details = Column(Text, nullable=True, comment="JSON 형태의 상세 정보")
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    user = relationship("User", back_populates="audit_logs")

    __table_args__ = (
        Index("ix_audit_logs_tenant", "tenant_id", "created_at"),
        Index("ix_audit_logs_action", "action", "created_at"),
    )
