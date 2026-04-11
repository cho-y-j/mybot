"""Admin 공통 유틸리티."""
from fastapi import HTTPException


def require_superadmin(user: dict):
    if not user.get("is_superadmin"):
        raise HTTPException(status_code=403, detail="관리자 권한 필요")
    return user
