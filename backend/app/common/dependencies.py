"""
ElectionPulse - FastAPI Dependencies
인증 확인, 테넌트 컨텍스트, 권한 검증
"""
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db, get_tenant_db
from app.common.security import decode_token, TokenPayload

security_scheme = HTTPBearer()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """
    현재 로그인한 사용자 정보 반환.
    모든 인증 필요 엔드포인트에서 사용.
    """
    token_data = decode_token(credentials.credentials)
    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if token_data.type != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    # DB에서 사용자 조회 (활성 상태 확인)
    from app.auth.models import User
    result = await db.execute(select(User).where(User.id == token_data.sub))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or deactivated",
        )
    if user.is_locked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is locked. Contact support.",
        )

    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "tenant_id": str(user.tenant_id) if user.tenant_id else None,
        "role": user.role,
        "is_superadmin": user.is_superadmin,
    }


CurrentUser = Annotated[dict, Depends(get_current_user)]


def require_role(*roles: str):
    """역할 기반 접근 제어 데코레이터."""
    async def checker(user: CurrentUser):
        if user["is_superadmin"]:
            return user
        if user["role"] not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role: {', '.join(roles)}",
            )
        return user
    return Depends(checker)


def require_tenant():
    """테넌트 소속 필수 확인."""
    async def checker(user: CurrentUser):
        if not user["tenant_id"] and not user["is_superadmin"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tenant assigned. Contact admin.",
            )
        return user
    return Depends(checker)


RequireAdmin = require_role("admin")
RequireAnalyst = require_role("admin", "analyst")
RequireViewer = require_role("admin", "analyst", "viewer")
RequireSuperAdmin = require_role("super_admin")
