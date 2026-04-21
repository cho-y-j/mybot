"""
schedules_v2 — FastAPI router
URL: /api/candidate-schedules/*
"""
from datetime import datetime, timedelta, timezone, date
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.common.election_access import can_access_election

from app.schedules_v2.models import CandidateSchedule
from app.schedules_v2.schemas import (
    ScheduleCreate, ScheduleUpdate, ScheduleResultInput, ScheduleOut,
    ParseRequest, ParseResponse,
)

router = APIRouter()

KST = timezone(timedelta(hours=9))


# ─── 권한 유틸 ──────────────────────────────────────────────────────────────

async def _check_access(db: AsyncSession, user: dict, election_id: UUID):
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(403, "No tenant")
    if user.get("is_superadmin"):
        return
    if not await can_access_election(db, tid, election_id):
        raise HTTPException(403, "election access denied")


async def _load_schedule_or_404(
    db: AsyncSession, schedule_id: UUID, user: dict,
) -> CandidateSchedule:
    sched = (await db.execute(
        select(CandidateSchedule).where(CandidateSchedule.id == schedule_id)
    )).scalar_one_or_none()
    if not sched:
        raise HTTPException(404, "schedule not found")
    await _check_access(db, user, sched.election_id)
    return sched


async def _resolve_default_visibility(db: AsyncSession, tenant_id: str) -> str:
    """tenants.schedule_default_public → 'public'/'internal'."""
    from sqlalchemy import text
    row = (await db.execute(
        text("SELECT COALESCE(schedule_default_public, false) FROM tenants WHERE id = :tid"),
        {"tid": str(tenant_id)},
    )).scalar()
    return "public" if row else "internal"


# ─── 조회 ───────────────────────────────────────────────────────────────────

@router.get("/{election_id}", response_model=list[ScheduleOut])
async def list_schedules(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    from_: Optional[datetime] = Query(None, alias="from"),
    to: Optional[datetime] = None,
    candidate_id: Optional[UUID] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    visibility: Optional[str] = None,
):
    """범위 조회. from/to 없으면 기본 오늘±7일."""
    await _check_access(db, user, election_id)

    if not from_:
        now = datetime.now(KST)
        from_ = (now - timedelta(days=7)).astimezone(timezone.utc)
    if not to:
        to = (datetime.now(KST) + timedelta(days=30)).astimezone(timezone.utc)

    conditions = [
        CandidateSchedule.election_id == election_id,
        CandidateSchedule.starts_at >= from_,
        CandidateSchedule.starts_at <= to,
    ]
    if candidate_id:
        conditions.append(CandidateSchedule.candidate_id == candidate_id)
    if category:
        conditions.append(CandidateSchedule.category == category)
    if status:
        conditions.append(CandidateSchedule.status == status)
    if visibility:
        conditions.append(CandidateSchedule.visibility == visibility)

    rows = (await db.execute(
        select(CandidateSchedule)
        .where(and_(*conditions))
        .order_by(CandidateSchedule.starts_at.asc())
    )).scalars().all()

    # candidate_name 채우기
    from app.elections.models import Candidate
    cand_ids = {r.candidate_id for r in rows}
    names = {}
    if cand_ids:
        for c in (await db.execute(
            select(Candidate).where(Candidate.id.in_(cand_ids))
        )).scalars().all():
            names[c.id] = c.name

    result = []
    for r in rows:
        obj = ScheduleOut.model_validate(r)
        obj.candidate_name = names.get(r.candidate_id)
        result.append(obj)
    return result


@router.get("/{election_id}/yesterday", response_model=list[ScheduleOut])
async def list_yesterday(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """어제 회고용 — 어제 00:00~23:59 KST 범위의 일정."""
    await _check_access(db, user, election_id)

    now_kst = datetime.now(KST)
    yesterday = now_kst.date() - timedelta(days=1)
    y_start = datetime.combine(yesterday, datetime.min.time(), tzinfo=KST).astimezone(timezone.utc)
    y_end = datetime.combine(yesterday, datetime.max.time(), tzinfo=KST).astimezone(timezone.utc)

    rows = (await db.execute(
        select(CandidateSchedule)
        .where(
            CandidateSchedule.election_id == election_id,
            CandidateSchedule.starts_at >= y_start,
            CandidateSchedule.starts_at <= y_end,
        )
        .order_by(CandidateSchedule.starts_at.asc())
    )).scalars().all()

    from app.elections.models import Candidate
    cand_ids = {r.candidate_id for r in rows}
    names = {}
    if cand_ids:
        for c in (await db.execute(
            select(Candidate).where(Candidate.id.in_(cand_ids))
        )).scalars().all():
            names[c.id] = c.name

    result = []
    for r in rows:
        obj = ScheduleOut.model_validate(r)
        obj.candidate_name = names.get(r.candidate_id)
        result.append(obj)
    return result


# ─── 생성 ───────────────────────────────────────────────────────────────────

@router.post("/{election_id}", response_model=ScheduleOut)
async def create_schedule(
    election_id: UUID,
    payload: ScheduleCreate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """단건 일정 생성."""
    await _check_access(db, user, election_id)

    # visibility 기본값 — 캠프 설정 따름
    vis = payload.visibility or await _resolve_default_visibility(db, user["tenant_id"])

    sched = CandidateSchedule(
        election_id=election_id,
        candidate_id=payload.candidate_id,
        tenant_id=user["tenant_id"],
        title=payload.title,
        description=payload.description,
        location=payload.location,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        all_day=payload.all_day,
        category=payload.category,
        visibility=vis,
        recurrence_rule=payload.recurrence_rule,
        created_by=user["id"],
    )
    db.add(sched)
    await db.commit()
    await db.refresh(sched)

    # 지오코딩 트리거 (Phase 1-D에서 구현, 여기선 placeholder)
    try:
        from app.schedules_v2.geocode import trigger_geocode
        await trigger_geocode(sched.id)
    except Exception:
        pass

    return ScheduleOut.model_validate(sched)


@router.post("/{election_id}/bulk", response_model=list[ScheduleOut])
async def create_schedules_bulk(
    election_id: UUID,
    payloads: list[ScheduleCreate],
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """여러 줄 파싱 결과 일괄 저장 (source_input_id 공유)."""
    await _check_access(db, user, election_id)

    if not payloads:
        raise HTTPException(400, "empty list")

    vis_default = await _resolve_default_visibility(db, user["tenant_id"])
    group_id = uuid4()
    objs = []
    for p in payloads:
        vis = p.visibility or vis_default
        obj = CandidateSchedule(
            election_id=election_id,
            candidate_id=p.candidate_id,
            tenant_id=user["tenant_id"],
            title=p.title,
            description=p.description,
            location=p.location,
            starts_at=p.starts_at,
            ends_at=p.ends_at,
            all_day=p.all_day,
            category=p.category,
            visibility=vis,
            recurrence_rule=p.recurrence_rule,
            source_input_id=group_id,
            created_by=user["id"],
        )
        db.add(obj)
        objs.append(obj)

    await db.commit()
    for o in objs:
        await db.refresh(o)

    # 지오코딩 트리거
    try:
        from app.schedules_v2.geocode import trigger_geocode
        for o in objs:
            await trigger_geocode(o.id)
    except Exception:
        pass

    return [ScheduleOut.model_validate(o) for o in objs]


# ─── 수정 ───────────────────────────────────────────────────────────────────

@router.patch("/{schedule_id}", response_model=ScheduleOut)
async def update_schedule(
    schedule_id: UUID,
    payload: ScheduleUpdate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    sched = await _load_schedule_or_404(db, schedule_id, user)

    updated_location = False
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == 'location' and value != sched.location:
            updated_location = True
        setattr(sched, field, value)

    if updated_location:
        # 위치 바뀌면 지오코딩 필드 초기화 → 재계산
        sched.location_lat = None
        sched.location_lng = None
        sched.admin_sido = None
        sched.admin_sigungu = None
        sched.admin_dong = None
        sched.admin_ri = None

    await db.commit()
    await db.refresh(sched)

    if updated_location:
        try:
            from app.schedules_v2.geocode import trigger_geocode
            await trigger_geocode(sched.id)
        except Exception:
            pass

    return ScheduleOut.model_validate(sched)


# ─── 결과 입력 ──────────────────────────────────────────────────────────────

@router.post("/{schedule_id}/result", response_model=ScheduleOut)
async def update_result(
    schedule_id: UUID,
    payload: ScheduleResultInput,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    sched = await _load_schedule_or_404(db, schedule_id, user)

    if payload.result_mood is not None:
        sched.result_mood = payload.result_mood
    if payload.result_summary is not None:
        sched.result_summary = payload.result_summary
    if payload.attended_count is not None:
        sched.attended_count = payload.attended_count

    # 결과가 들어오면 status='done' 자동 (과거 일정이면)
    if sched.status == 'planned' and sched.ends_at < datetime.now(timezone.utc):
        sched.status = 'done'

    await db.commit()
    await db.refresh(sched)
    return ScheduleOut.model_validate(sched)


# ─── 취소 (soft) ─────────────────────────────────────────────────────────────

@router.delete("/{schedule_id}")
async def cancel_schedule(
    schedule_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    sched = await _load_schedule_or_404(db, schedule_id, user)
    sched.status = 'canceled'
    await db.commit()
    return {"status": "canceled", "id": str(sched.id)}


# ─── 자연어 파싱 (Phase 1-C에서 parser 구현) ────────────────────────────────

@router.post("/{election_id}/parse", response_model=ParseResponse)
async def parse_natural_input(
    election_id: UUID,
    payload: ParseRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """자연어 입력 → 구조화 일정 배열. 저장 안 함. 사용자 확인 후 /bulk 또는 / 로 저장."""
    await _check_access(db, user, election_id)

    from app.schedules_v2.parser import parse_schedule_text
    return await parse_schedule_text(payload)
