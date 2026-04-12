"""
ElectionPulse - Auth API Router
회원가입, 로그인, 토큰 갱신, 비밀번호 관리, 2FA
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.security import (
    hash_password, verify_password, validate_password_strength,
    create_access_token, create_refresh_token, decode_token,
    generate_totp_secret, get_totp_uri, verify_totp,
)
from app.common.dependencies import get_current_user, CurrentUser
from app.auth.models import User, RefreshToken, AuditLog
from app.auth.schemas import (
    RegisterRequest, VerifyEmailRequest, LoginRequest,
    TokenResponse, RefreshRequest, ForgotPasswordRequest,
    ResetPasswordRequest, UserProfile, Enable2FAResponse,
    MessageResponse, ApplyRequest,
)
from app.config import get_settings

router = APIRouter()
settings = get_settings()


def _user_profile(u) -> UserProfile:
    """User ORM → UserProfile response."""
    return UserProfile(
        id=str(u.id),
        email=u.email,
        name=u.name,
        phone=u.phone,
        role=u.role,
        tenant_id=str(u.tenant_id) if u.tenant_id else None,
        tenant_name=u.tenant.name if u.tenant else None,
        is_superadmin=u.is_superadmin,
        totp_enabled=u.totp_enabled,
        created_at=u.created_at,
    )


def _select_user():
    """User + tenant eager loading."""
    return select(User).options(selectinload(User.tenant))


@router.post("/apply", response_model=MessageResponse, status_code=201)
async def apply_for_account(req: ApplyRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """가입 신청 — 관리자 승인 필요."""
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 등록된 이메일입니다")

    valid, msg = validate_password_strength(req.password)
    if not valid:
        raise HTTPException(status_code=400, detail=msg)

    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        password_plain=req.password,
        name=req.name,
        phone=req.phone,
        is_active=False,
        email_verified=False,
        approval_status="pending",
        applied_at=datetime.now(timezone.utc),
        organization=req.organization,
        election_type_applied=req.election_type,
        region_applied=req.region,
        candidate_name_applied=req.candidate_name,
        position_in_camp=req.position,
        apply_reason=req.reason,
        role="admin",
    )
    db.add(user)
    db.add(AuditLog(
        user_id=user.id, action="apply", resource_type="user",
        ip_address=request.client.host if request.client else None,
    ))
    await db.flush()

    return MessageResponse(
        message="가입 신청이 접수되었습니다. 관리자 승인 후 이용 가능합니다.",
    )


@router.post("/register", response_model=MessageResponse, status_code=201)
async def register(req: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 등록된 이메일입니다")

    valid, msg = validate_password_strength(req.password)
    if not valid:
        raise HTTPException(status_code=400, detail=msg)

    verify_code = f"{secrets.randbelow(1000000):06d}"

    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        password_plain=req.password,
        name=req.name,
        phone=req.phone,
        is_active=False,
        email_verified=False,
        email_verify_code=verify_code,
        email_verify_expires=datetime.now(timezone.utc) + timedelta(hours=1),
        role="admin",
    )
    db.add(user)
    db.add(AuditLog(
        user_id=user.id, action="register", resource_type="user",
        ip_address=request.client.host if request.client else None,
    ))
    await db.flush()

    return MessageResponse(
        message=f"인증 코드가 {req.email}로 발송되었습니다. (개발모드 코드: {verify_code})",
    )


@router.post("/verify-email", response_model=MessageResponse)
async def verify_email(req: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if user.email_verified:
        return MessageResponse(message="이미 인증된 이메일입니다")
    if user.email_verify_code != req.code:
        raise HTTPException(status_code=400, detail="인증 코드가 올바르지 않습니다")
    if user.email_verify_expires and user.email_verify_expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="인증 코드가 만료되었습니다")

    user.email_verified = True
    user.is_active = True
    user.email_verify_code = None
    user.email_verify_expires = None
    return MessageResponse(message="이메일 인증이 완료되었습니다. 로그인해주세요.")


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(_select_user().where(User.email == req.email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다")

    if user.is_locked:
        if user.locked_until and user.locked_until > datetime.now(timezone.utc):
            remaining = (user.locked_until - datetime.now(timezone.utc)).seconds // 60
            raise HTTPException(status_code=423, detail=f"계정이 잠겼습니다. {remaining}분 후 다시 시도해주세요.")
        user.is_locked = False
        user.failed_login_attempts = 0
        user.locked_until = None

    if not verify_password(req.password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= settings.ACCOUNT_LOCKOUT_ATTEMPTS:
            user.is_locked = True
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCOUNT_LOCKOUT_MINUTES)
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다")

    if not user.is_active:
        if hasattr(user, 'approval_status') and user.approval_status == "pending":
            raise HTTPException(status_code=403, detail="가입 신청이 아직 승인되지 않았습니다. 관리자 승인을 기다려주세요.")
        elif hasattr(user, 'approval_status') and user.approval_status == "rejected":
            raise HTTPException(status_code=403, detail="가입 신청이 거절되었습니다.")
        raise HTTPException(status_code=403, detail="이메일 인증을 완료해주세요")

    if user.totp_enabled:
        if not req.totp_code:
            raise HTTPException(status_code=400, detail="2FA 인증 코드를 입력해주세요")
        if not verify_totp(user.totp_secret, req.totp_code):
            raise HTTPException(status_code=401, detail="2FA 코드가 올바르지 않습니다")

    user.failed_login_attempts = 0
    user.last_login_at = datetime.now(timezone.utc)
    user.last_login_ip = request.client.host if request.client else None

    tenant_id = str(user.tenant_id) if user.tenant_id else ""
    access_token = create_access_token(str(user.id), tenant_id, user.role)
    refresh_token = create_refresh_token(str(user.id))

    rt = RefreshToken(
        user_id=user.id,
        token_hash=hashlib.sha256(refresh_token.encode()).hexdigest(),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(rt)
    db.add(AuditLog(
        user_id=user.id, tenant_id=user.tenant_id, action="login",
        ip_address=request.client.host if request.client else None,
    ))

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=_user_profile(user),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token_endpoint(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(req.refresh_token)
    if not payload or payload.type != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    result = await db.execute(_select_user().where(User.id == payload.sub))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found")

    tenant_id = str(user.tenant_id) if user.tenant_id else ""
    new_access = create_access_token(str(user.id), tenant_id, user.role)
    new_refresh = create_refresh_token(str(user.id))

    return TokenResponse(
        access_token=new_access,
        refresh_token=new_refresh,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=_user_profile(user),
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(user: CurrentUser, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.user_id == user["id"], RefreshToken.revoked == False)
    )
    for token in result.scalars().all():
        token.revoked = True
        token.revoked_at = datetime.now(timezone.utc)
    return MessageResponse(message="로그아웃 되었습니다")


@router.get("/me", response_model=UserProfile)
async def get_profile(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(_select_user().where(User.id == user["id"]))
    u = result.scalar_one()
    return _user_profile(u)


@router.post("/enable-2fa", response_model=Enable2FAResponse)
async def enable_2fa(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user["id"]))
    u = result.scalar_one()
    if u.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA가 이미 활성화되어 있습니다")
    secret = generate_totp_secret()
    u.totp_secret = secret
    return Enable2FAResponse(secret=secret, qr_uri=get_totp_uri(secret, u.email))


@router.post("/confirm-2fa", response_model=MessageResponse)
async def confirm_2fa(code: str, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user["id"]))
    u = result.scalar_one()
    if not u.totp_secret:
        raise HTTPException(status_code=400, detail="먼저 /enable-2fa를 호출해주세요")
    if not verify_totp(u.totp_secret, code):
        raise HTTPException(status_code=400, detail="코드가 올바르지 않습니다")
    u.totp_enabled = True
    return MessageResponse(message="2FA가 활성화되었습니다")
