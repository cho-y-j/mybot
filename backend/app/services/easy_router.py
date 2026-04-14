"""쉬운 모드 전용 API 엔드포인트."""
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.common.election_access import can_access_election
from app.elections.models import Election
from app.services.today_actions import get_today_actions

router = APIRouter()


@router.get("/today/{election_id}")
async def todays_actions(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """오늘 해야 할 일 (쉬운 모드 홈용)."""
    tid = user["tenant_id"]
    if not tid:
        return {"actions": [], "summary": {}, "our_candidate": None, "election": None}
    if not await can_access_election(db, tid, election_id):
        return {"actions": [], "error": "선거 접근 권한 없음"}

    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
    d_day = None
    if election and election.election_date:
        d_day = (election.election_date - date.today()).days

    result = await get_today_actions(db, str(tid), str(election_id))
    result["election"] = {
        "id": str(election_id),
        "name": election.name if election else None,
        "d_day": d_day,
        "date": election.election_date.isoformat() if election and election.election_date else None,
    }
    return result
