"""
ElectionPulse - 이벤트 타임라인 + AI 추천 API
"""
from uuid import UUID
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.elections.history_models import ElectionEvent, AIRecommendation

router = APIRouter()


# ──── Events ────

class EventCreate(BaseModel):
    event_date: str
    event_type: str  # debate|announcement|controversy|rally|media|poll|other
    title: str
    description: Optional[str] = None
    candidate_name: Optional[str] = None
    importance: str = "medium"


@router.get("/events/{election_id}")
async def list_events(election_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """선거 이벤트 타임라인."""
    result = await db.execute(
        select(ElectionEvent).where(
            ElectionEvent.election_id == election_id,
            ElectionEvent.tenant_id == user["tenant_id"],
        ).order_by(ElectionEvent.event_date.desc())
    )
    return [
        {
            "id": str(e.id), "date": e.event_date.isoformat(),
            "type": e.event_type, "title": e.title,
            "description": e.description, "candidate": e.candidate_name,
            "importance": e.importance,
        }
        for e in result.scalars().all()
    ]


@router.post("/events/{election_id}", status_code=201)
async def create_event(election_id: UUID, req: EventCreate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """이벤트 추가."""
    event = ElectionEvent(
        tenant_id=user["tenant_id"],
        election_id=election_id,
        event_date=date.fromisoformat(req.event_date),
        event_type=req.event_type,
        title=req.title,
        description=req.description,
        candidate_name=req.candidate_name,
        importance=req.importance,
    )
    db.add(event)
    await db.flush()
    return {"id": str(event.id), "message": "이벤트가 추가되었습니다"}


@router.delete("/events/{election_id}/{event_id}", status_code=204)
async def delete_event(election_id: UUID, event_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """이벤트 삭제."""
    result = await db.execute(
        select(ElectionEvent).where(ElectionEvent.id == event_id, ElectionEvent.tenant_id == user["tenant_id"])
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404)
    await db.delete(event)


# ──── AI Recommendations ────

@router.get("/recommendations/{election_id}")
async def list_recommendations(
    election_id: UUID,
    status: str = "pending",
    user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """AI 추천 목록."""
    query = select(AIRecommendation).where(
        AIRecommendation.election_id == election_id,
        AIRecommendation.tenant_id == user["tenant_id"],
    )
    if status != "all":
        query = query.where(AIRecommendation.status == status)
    query = query.order_by(AIRecommendation.created_at.desc())

    result = await db.execute(query)
    return [
        {
            "id": str(r.id), "type": r.rec_type, "title": r.title,
            "description": r.description, "priority": r.priority,
            "status": r.status, "source": r.source,
            "data": r.data, "created_at": r.created_at.isoformat(),
        }
        for r in result.scalars().all()
    ]


@router.put("/recommendations/{rec_id}/respond")
async def respond_recommendation(
    rec_id: UUID,
    action: str,  # approved|rejected|dismissed
    response: str = None,
    user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """AI 추천에 응답."""
    result = await db.execute(
        select(AIRecommendation).where(
            AIRecommendation.id == rec_id, AIRecommendation.tenant_id == user["tenant_id"],
        )
    )
    rec = result.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404)

    rec.status = action
    rec.user_response = response
    rec.responded_at = datetime.now(timezone.utc)

    return {"message": f"추천이 '{action}' 처리되었습니다"}
