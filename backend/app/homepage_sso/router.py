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
import re
import jwt

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.config import settings

router = APIRouter(prefix="/api/sso", tags=["sso"])

# mybot 경로와 충돌하면 안 되는 예약어 — ai.on1.kr/{code}가 /kim 이면 kim은 homepage로 가지만
# "dashboard" 같은 값이 들어오면 사용자가 영영 분석 페이지에 못 들어감
RESERVED_CODES = {
    "api", "_next", "static", "favicon.ico", "robots.txt", "sitemap.xml",
    "dashboard", "easy", "onboarding", "login", "signup", "logout",
    "admin", "super-admin", "chat", "home", "settings", "billing",
    "reports", "elections", "debate", "content", "candidates", "news",
    "surveys", "trends", "youtube", "schedules", "assistant", "history",
    "analytics", "auth", "sso", "public",
}
CODE_PATTERN = re.compile(r"^[a-z][a-z0-9-]{1,28}[a-z0-9]$")


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


class ChangeCodeRequest(BaseModel):
    new_code: str = Field(..., min_length=3, max_length=30)


@router.post("/homepage/change-code")
async def change_homepage_code(
    req: ChangeCodeRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """홈페이지 슬러그 변경 — 예약어 + 형식 + 중복 검증."""
    new_code = req.new_code.lower().strip()

    # 형식: 영문소문자 시작, 영문/숫자/하이픈, 3~30자, 끝 하이픈 불가
    if not CODE_PATTERN.match(new_code):
        raise HTTPException(400, "영문 소문자로 시작하는 3~30자(영문/숫자/하이픈)만 가능합니다")
    if new_code in RESERVED_CODES:
        raise HTTPException(400, f"'{new_code}'는 시스템 예약어입니다. 다른 이름을 사용해주세요")

    # 중복 확인
    dup = (await db.execute(text(
        "SELECT id FROM homepage.users WHERE code = :code AND tenant_id != cast(:tid as uuid)"
    ), {"code": new_code, "tid": user["tenant_id"]})).first()
    if dup:
        raise HTTPException(409, "이미 사용 중인 주소입니다")

    # 업데이트
    result = await db.execute(text(
        "UPDATE homepage.users SET code = :code, updated_at = NOW() "
        "WHERE tenant_id = cast(:tid as uuid) RETURNING id"
    ), {"code": new_code, "tid": user["tenant_id"]})
    if not result.first():
        raise HTTPException(404, "홈페이지가 아직 준비되지 않았습니다")
    await db.commit()

    return {"success": True, "code": new_code, "public_url": f"/{new_code}"}
