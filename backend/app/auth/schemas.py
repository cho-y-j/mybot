"""
ElectionPulse - Auth Request/Response Schemas
Pydantic 모델로 입출력 타입 안전하게 관리
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator


class RegisterRequest(BaseModel):
    """회원가입 요청."""
    email: EmailStr
    password: str
    name: str
    phone: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("비밀번호는 8자 이상이어야 합니다")
        if not any(c.isupper() for c in v):
            raise ValueError("대문자를 1개 이상 포함해야 합니다")
        if not any(c.islower() for c in v):
            raise ValueError("소문자를 1개 이상 포함해야 합니다")
        if not any(c.isdigit() for c in v):
            raise ValueError("숫자를 1개 이상 포함해야 합니다")
        return v

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("이름을 입력해주세요")
        return v.strip()


class VerifyEmailRequest(BaseModel):
    """이메일 인증 요청."""
    email: EmailStr
    code: str


class LoginRequest(BaseModel):
    """로그인 요청."""
    email: EmailStr
    password: str
    totp_code: Optional[str] = None


class TokenResponse(BaseModel):
    """로그인 성공 응답."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserProfile"


class RefreshRequest(BaseModel):
    """토큰 갱신 요청."""
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    """비밀번호 찾기 요청."""
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """비밀번호 재설정."""
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("비밀번호는 8자 이상이어야 합니다")
        return v


class UserProfile(BaseModel):
    """사용자 프로필 응답."""
    id: str
    email: str
    name: str
    phone: Optional[str] = None
    role: str
    tenant_id: Optional[str] = None
    tenant_name: Optional[str] = None
    is_superadmin: bool = False
    totp_enabled: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class Enable2FAResponse(BaseModel):
    """2FA 활성화 응답."""
    secret: str
    qr_uri: str


class MessageResponse(BaseModel):
    """일반 메시지 응답."""
    message: str
    success: bool = True


class ApplyRequest(BaseModel):
    """가입 신청 요청."""
    email: EmailStr
    password: str
    name: str
    phone: str
    organization: str
    election_type: str
    region: Optional[str] = None
    candidate_name: str
    position: Optional[str] = None
    reason: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("비밀번호는 8자 이상이어야 합니다")
        return v

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("이름을 입력해주세요")
        return v.strip()
