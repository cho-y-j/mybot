"""
ElectionPulse ↔ MyHome SSO 브릿지.

mybot에 로그인한 사용자가 홈페이지 편집기로 이동할 때,
homepage(Next.js, 다른 프로세스)에서 재로그인하지 않도록 단기 JWT 발급.
homepage 측 `/api/auth/sso?token=...` 엔드포인트가 이 토큰을 받아
자체 session 쿠키를 구워준다.

보안:
- HS256, APP_SECRET_KEY 공유 (homepage에 SSO_SECRET env로 주입)
- exp=60초 — 1회성, 재사용 불가 수준의 짧은 윈도우
- tenant_id / homepage_user_id / code 만 담음
"""
from datetime import datetime, timedelta, timezone
import jwt

from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.config import settings

router = APIRouter(prefix="/api/sso", tags=["sso"])


@router.get("/homepage")
async def issue_homepage_sso(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """홈페이지 편집기로 이동할 때 호출.

    Returns:
        code: 홈페이지 슬러그 (ai.on1.kr/{code})
        url: 편집 페이지 전체 URL (sso 토큰 포함)
        public_url: 후보 공개 홈페이지 URL (후보가 홍보용으로 뿌림)
        exists: homepage User가 아직 생성 안 되었으면 false
    """
    tenant_id = user["tenant_id"]

    row = (await db.execute(text(
        "SELECT id, code FROM homepage.users WHERE tenant_id = cast(:tid as uuid)"
    ), {"tid": tenant_id})).first()

    if not row:
        return {"exists": False, "code": None, "url": None, "public_url": None,
                "message": "홈페이지가 아직 준비되지 않았습니다 (부트스트랩 진행 중)"}

    homepage_user_id, code = row[0], row[1]

    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": str(homepage_user_id),
        "tenant_id": str(tenant_id),
        "code": code,
        "type": "homepage_sso",
        "exp": now + timedelta(seconds=60),
        "iat": now,
    }, settings.APP_SECRET_KEY, algorithm="HS256")

    return {
        "exists": True,
        "code": code,
        "url": f"/{code}/admin?sso={token}",
        "public_url": f"/{code}",
    }
