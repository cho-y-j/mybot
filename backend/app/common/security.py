"""
ElectionPulse - Security Utilities
비밀번호 해싱, JWT 토큰, 입력 검증
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import secrets
import bcrypt
import jwt
import pyotp
from pydantic import BaseModel

from app.config import get_settings

settings = get_settings()


# ──────────────── Password Hashing (bcrypt) ────────────────────────────────

def hash_password(password: str) -> str:
    """bcrypt 해싱 (cost=12). 레인보우 테이블 방어."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """비밀번호 검증."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def validate_password_strength(password: str) -> tuple[bool, str]:
    """비밀번호 강도 검사."""
    if len(password) < settings.PASSWORD_MIN_LENGTH:
        return False, f"비밀번호는 {settings.PASSWORD_MIN_LENGTH}자 이상이어야 합니다."
    if not any(c.isupper() for c in password):
        return False, "대문자를 1개 이상 포함해야 합니다."
    if not any(c.islower() for c in password):
        return False, "소문자를 1개 이상 포함해야 합니다."
    if not any(c.isdigit() for c in password):
        return False, "숫자를 1개 이상 포함해야 합니다."
    if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in password):
        return False, "특수문자를 1개 이상 포함해야 합니다."
    return True, "OK"


# ──────────────── JWT Token (RS256) ────────────────────────────────────────

def _load_key(path: str) -> str:
    """PEM 키 파일 로드."""
    key_path = settings.BASE_DIR / path
    if not key_path.exists():
        # 개발 환경: 키 파일 없으면 HS256 대체용 시크릿 반환
        return settings.APP_SECRET_KEY
    return key_path.read_text()


def _get_algorithm() -> str:
    """키 파일 존재 여부에 따라 알고리즘 결정."""
    key_path = settings.BASE_DIR / settings.JWT_PRIVATE_KEY_PATH
    if key_path.exists():
        return "RS256"
    return "HS256"


class TokenPayload(BaseModel):
    sub: str              # user_id
    tenant_id: str = ""
    role: str = "viewer"
    type: str = "access"  # access | refresh
    exp: datetime
    iat: datetime


def create_access_token(
    user_id: str,
    tenant_id: str = "",
    role: str = "viewer",
) -> str:
    """Access Token 생성 (기본 15분)."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "role": role,
        "type": "access",
        "exp": now + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES),
        "iat": now,
    }
    algorithm = _get_algorithm()
    key = _load_key(settings.JWT_PRIVATE_KEY_PATH)
    return jwt.encode(payload, key, algorithm=algorithm)


def create_refresh_token(user_id: str) -> str:
    """Refresh Token 생성 (기본 7일).

    jti(JWT ID, 랜덤 16바이트)로 같은 user+초에 발급된 토큰도 항상 고유.
    Why: refresh_tokens.token_hash UNIQUE 위반 방지 — 사용자가 1초 내 2회 로그인하면
    이전 코드는 동일 payload → 동일 hash 충돌로 500 에러.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": "refresh",
        "jti": secrets.token_hex(16),
        "exp": now + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS),
        "iat": now,
    }
    algorithm = _get_algorithm()
    key = _load_key(settings.JWT_PRIVATE_KEY_PATH)
    return jwt.encode(payload, key, algorithm=algorithm)


def decode_token(token: str) -> Optional[TokenPayload]:
    """JWT 토큰 디코딩 및 검증."""
    try:
        algorithm = _get_algorithm()
        key = _load_key(settings.JWT_PUBLIC_KEY_PATH)
        data = jwt.decode(token, key, algorithms=[algorithm])
        return TokenPayload(**data)
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


# ──────────────── 2FA (TOTP) ───────────────────────────────────────────────

def generate_totp_secret() -> str:
    """TOTP 시크릿 생성."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str) -> str:
    """Google Authenticator용 URI 생성."""
    return pyotp.totp.TOTP(secret).provisioning_uri(
        name=email,
        issuer_name="ElectionPulse",
    )


def verify_totp(secret: str, code: str) -> bool:
    """TOTP 코드 검증 (30초 윈도우, ±1 허용)."""
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


# ──────────────── Input Sanitization ───────────────────────────────────────

def sanitize_input(text: str) -> str:
    """기본 XSS 방지 이스케이프."""
    if not text:
        return text
    replacements = {
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#x27;",
        "&": "&amp;",
    }
    # & must be first to avoid double-escaping
    result = text.replace("&", "&amp;")
    for char, replacement in replacements.items():
        if char != "&":
            result = result.replace(char, replacement)
    return result
