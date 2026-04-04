"""
ElectionPulse - Election Management API
선거/후보자/키워드 CRUD — 고객이 직접 경쟁자 추가 가능
"""
from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.common.dependencies import CurrentUser, RequireAnalyst, RequireAdmin
from app.elections.models import Election, Candidate, Keyword, ScheduleConfig
from app.elections.schemas import (
    ElectionCreate, ElectionUpdate, ElectionResponse,
    CandidateCreate, CandidateUpdate, CandidateResponse,
    KeywordCreate, KeywordResponse,
    ScheduleConfigCreate, ScheduleConfigResponse,
)

router = APIRouter()


# ──────────────── Elections ─────────────────────────────────────────────────

@router.get("", response_model=list[ElectionResponse])
async def list_elections(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """내 테넌트의 선거 목록 조회."""
    query = select(Election).where(Election.tenant_id == user["tenant_id"])
    result = await db.execute(query)
    elections = result.scalars().all()

    responses = []
    for e in elections:
        # 후보자/키워드 수 카운트
        c_count = await db.execute(
            select(func.count()).where(Candidate.election_id == e.id)
        )
        k_count = await db.execute(
            select(func.count()).where(Keyword.election_id == e.id)
        )
        d_day = (e.election_date - date.today()).days

        responses.append(ElectionResponse(
            id=str(e.id),
            name=e.name,
            election_type=e.election_type,
            region_sido=e.region_sido,
            region_sigungu=e.region_sigungu,
            election_date=e.election_date,
            is_active=e.is_active,
            our_candidate_id=str(e.our_candidate_id) if e.our_candidate_id else None,
            d_day=d_day,
            candidates_count=c_count.scalar(),
            keywords_count=k_count.scalar(),
            created_at=e.created_at,
        ))

    return responses


@router.post("", response_model=ElectionResponse, status_code=201)
async def create_election(
    req: ElectionCreate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """선거 생성 (관리자 초기 셋팅 또는 고객 직접 생성)."""
    # 요금제별 선거 수 제한 확인
    from app.auth.models import Tenant
    tenant = await db.execute(select(Tenant).where(Tenant.id == user["tenant_id"]))
    tenant = tenant.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="테넌트를 찾을 수 없습니다")

    existing_count = await db.execute(
        select(func.count()).where(
            Election.tenant_id == user["tenant_id"],
            Election.is_active == True,
        )
    )
    if existing_count.scalar() >= tenant.max_elections and not user["is_superadmin"]:
        raise HTTPException(
            status_code=403,
            detail=f"요금제 한도 초과: 최대 {tenant.max_elections}개 선거",
        )

    election = Election(
        tenant_id=user["tenant_id"],
        name=req.name,
        election_type=req.election_type,
        region_sido=req.region_sido,
        region_sigungu=req.region_sigungu,
        election_date=req.election_date,
    )
    db.add(election)
    await db.flush()

    d_day = (election.election_date - date.today()).days

    return ElectionResponse(
        id=str(election.id),
        name=election.name,
        election_type=election.election_type,
        region_sido=election.region_sido,
        region_sigungu=election.region_sigungu,
        election_date=election.election_date,
        is_active=election.is_active,
        our_candidate_id=None,
        d_day=d_day,
        candidates_count=0,
        keywords_count=0,
        created_at=election.created_at,
    )


# ──────────────── Candidates (고객이 직접 추가/수정 가능) ──────────────────

@router.get("/{election_id}/candidates", response_model=list[CandidateResponse])
async def list_candidates(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """후보자 목록 조회."""
    result = await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == user["tenant_id"],
        ).order_by(Candidate.is_our_candidate.desc(), Candidate.priority, Candidate.name)
    )
    candidates = result.scalars().all()
    return [
        CandidateResponse(
            id=str(c.id),
            name=c.name,
            party=c.party,
            party_alignment=c.party_alignment,
            role=c.role,
            is_our_candidate=c.is_our_candidate,
            enabled=c.enabled,
            search_keywords=c.search_keywords or [],
            homonym_filters=c.homonym_filters or [],
            sns_links=c.sns_links or {},
            career_summary=c.career_summary,
            created_at=c.created_at,
        )
        for c in candidates
    ]


@router.post("/{election_id}/candidates", response_model=CandidateResponse, status_code=201)
async def add_candidate(
    election_id: UUID,
    req: CandidateCreate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """후보자 추가 — 고객이 직접 경쟁자를 추가할 수 있음."""
    # 선거 소유권 확인
    election = await db.execute(
        select(Election).where(
            Election.id == election_id,
            Election.tenant_id == user["tenant_id"],
        )
    )
    election = election.scalar_one_or_none()
    if not election:
        raise HTTPException(status_code=404, detail="선거를 찾을 수 없습니다")

    # 후보자 수 제한 확인
    from app.auth.models import Tenant
    tenant = await db.execute(select(Tenant).where(Tenant.id == user["tenant_id"]))
    tenant = tenant.scalar_one()
    count = await db.execute(
        select(func.count()).where(Candidate.election_id == election_id)
    )
    if count.scalar() >= tenant.max_candidates and not user["is_superadmin"]:
        raise HTTPException(
            status_code=403,
            detail=f"요금제 한도 초과: 최대 {tenant.max_candidates}명 후보자",
        )

    # 기본 검색 키워드 자동 생성
    keywords = req.search_keywords or [req.name]
    if req.name not in keywords:
        keywords.insert(0, req.name)

    candidate = Candidate(
        election_id=election_id,
        tenant_id=user["tenant_id"],
        name=req.name,
        party=req.party,
        party_alignment=req.party_alignment,
        role=req.role,
        is_our_candidate=req.is_our_candidate,
        search_keywords=keywords,
        homonym_filters=req.homonym_filters,
        sns_links=req.sns_links,
        career_summary=req.career_summary,
    )
    db.add(candidate)
    await db.flush()

    # 우리 후보로 설정
    if req.is_our_candidate:
        election.our_candidate_id = candidate.id

    return CandidateResponse(
        id=str(candidate.id),
        name=candidate.name,
        party=candidate.party,
        party_alignment=candidate.party_alignment,
        role=candidate.role,
        is_our_candidate=candidate.is_our_candidate,
        enabled=candidate.enabled,
        search_keywords=candidate.search_keywords,
        homonym_filters=candidate.homonym_filters,
        sns_links=candidate.sns_links or {},
        career_summary=candidate.career_summary,
        created_at=candidate.created_at,
    )


@router.put("/{election_id}/candidates/{candidate_id}", response_model=CandidateResponse)
async def update_candidate(
    election_id: UUID,
    candidate_id: UUID,
    req: CandidateUpdate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """후보자 수정 — 고객이 직접 경쟁자 정보 수정 가능."""
    result = await db.execute(
        select(Candidate).where(
            Candidate.id == candidate_id,
            Candidate.election_id == election_id,
            Candidate.tenant_id == user["tenant_id"],
        )
    )
    candidate = result.scalar_one_or_none()
    if not candidate:
        raise HTTPException(status_code=404, detail="후보자를 찾을 수 없습니다")

    update_data = req.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(candidate, key, value)

    candidate.updated_at = datetime.now(timezone.utc)

    return CandidateResponse(
        id=str(candidate.id),
        name=candidate.name,
        party=candidate.party,
        party_alignment=candidate.party_alignment,
        role=candidate.role,
        is_our_candidate=candidate.is_our_candidate,
        enabled=candidate.enabled,
        search_keywords=candidate.search_keywords or [],
        homonym_filters=candidate.homonym_filters or [],
        sns_links=candidate.sns_links or {},
        career_summary=candidate.career_summary,
        created_at=candidate.created_at,
    )


@router.delete("/{election_id}/candidates/{candidate_id}", status_code=204)
async def delete_candidate(
    election_id: UUID,
    candidate_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """후보자 삭제."""
    result = await db.execute(
        select(Candidate).where(
            Candidate.id == candidate_id,
            Candidate.election_id == election_id,
            Candidate.tenant_id == user["tenant_id"],
        )
    )
    candidate = result.scalar_one_or_none()
    if not candidate:
        raise HTTPException(status_code=404, detail="후보자를 찾을 수 없습니다")
    if candidate.is_our_candidate:
        raise HTTPException(status_code=400, detail="우리 후보는 삭제할 수 없습니다")

    await db.delete(candidate)


# ──────────────── Keywords (고객이 직접 추가 가능) ──────────────────────────

@router.get("/{election_id}/keywords", response_model=list[KeywordResponse])
async def list_keywords(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """키워드 목록 조회."""
    result = await db.execute(
        select(Keyword).where(
            Keyword.election_id == election_id,
            Keyword.tenant_id == user["tenant_id"],
        )
    )
    return [
        KeywordResponse(
            id=str(k.id),
            word=k.word,
            category=k.category,
            candidate_id=str(k.candidate_id) if k.candidate_id else None,
            enabled=k.enabled,
        )
        for k in result.scalars().all()
    ]


@router.post("/{election_id}/keywords", response_model=KeywordResponse, status_code=201)
async def add_keyword(
    election_id: UUID,
    req: KeywordCreate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """키워드 추가 — 고객이 직접 추가 가능."""
    keyword = Keyword(
        election_id=election_id,
        tenant_id=user["tenant_id"],
        word=req.word,
        category=req.category,
        candidate_id=req.candidate_id,
    )
    db.add(keyword)
    await db.flush()

    return KeywordResponse(
        id=str(keyword.id),
        word=keyword.word,
        category=keyword.category,
        candidate_id=str(keyword.candidate_id) if keyword.candidate_id else None,
        enabled=keyword.enabled,
    )


# ──────────────── Schedules (자동 수집 스케줄) ─────────────────

SCHEDULE_TYPE_LABELS = {
    "news": "뉴스 수집",
    "community": "커뮤니티/블로그",
    "youtube": "유튜브 모니터링",
    "trends": "검색 트렌드",
    "briefing": "브리핑/보고서",
    "alert": "위기 감지",
}


@router.get("/{election_id}/schedules")
async def list_schedules(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """스케줄 목록 조회."""
    result = await db.execute(
        select(ScheduleConfig).where(
            ScheduleConfig.election_id == election_id,
            ScheduleConfig.tenant_id == user["tenant_id"],
        ).order_by(ScheduleConfig.name)
    )
    return [
        {
            "id": str(s.id),
            "name": s.name,
            "schedule_type": s.schedule_type,
            "type_label": SCHEDULE_TYPE_LABELS.get(s.schedule_type, s.schedule_type),
            "fixed_times": s.fixed_times or [],
            "enabled": s.enabled,
            "config": s.config or {},
        }
        for s in result.scalars().all()
    ]


@router.post("/{election_id}/schedules", status_code=201)
async def create_schedule(
    election_id: UUID,
    req: ScheduleConfigCreate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """스케줄 생성."""
    schedule = ScheduleConfig(
        election_id=election_id,
        tenant_id=user["tenant_id"],
        name=req.name,
        schedule_type=req.schedule_type,
        fixed_times=req.fixed_times,
        cron_expression=req.cron_expression,
        enabled=req.enabled,
        config=req.config,
    )
    db.add(schedule)
    await db.flush()
    return {"id": str(schedule.id), "name": schedule.name, "message": "스케줄이 생성되었습니다"}


@router.put("/{election_id}/schedules/{schedule_id}")
async def update_schedule(
    election_id: UUID,
    schedule_id: UUID,
    user: CurrentUser,
    enabled: bool = None,
    fixed_times: list[str] = None,
    name: str = None,
    db: AsyncSession = Depends(get_db),
):
    """스케줄 수정 (활성/비활성, 시간 변경)."""
    result = await db.execute(
        select(ScheduleConfig).where(
            ScheduleConfig.id == schedule_id,
            ScheduleConfig.tenant_id == user["tenant_id"],
        )
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="스케줄을 찾을 수 없습니다")

    if enabled is not None:
        schedule.enabled = enabled
    if fixed_times is not None:
        schedule.fixed_times = fixed_times
    if name is not None:
        schedule.name = name

    return {"id": str(schedule.id), "enabled": schedule.enabled, "message": "수정 완료"}


@router.delete("/{election_id}/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
    election_id: UUID,
    schedule_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """스케줄 삭제."""
    result = await db.execute(
        select(ScheduleConfig).where(
            ScheduleConfig.id == schedule_id,
            ScheduleConfig.tenant_id == user["tenant_id"],
        )
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="스케줄을 찾을 수 없습니다")
    await db.delete(schedule)


@router.post("/{election_id}/schedules/create-defaults")
async def create_default_schedules(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """요금제에 맞는 기본 스케줄 자동 생성."""
    from app.auth.models import Tenant

    # 이미 스케줄이 있는지 확인
    existing = await db.execute(
        select(func.count()).where(
            ScheduleConfig.election_id == election_id,
            ScheduleConfig.tenant_id == user["tenant_id"],
        )
    )
    if existing.scalar() > 0:
        raise HTTPException(status_code=400, detail="이미 스케줄이 존재합니다")

    tenant = (await db.execute(
        select(Tenant).where(Tenant.id == user["tenant_id"])
    )).scalar_one()

    # 요금제별 기본 스케줄
    templates = _get_default_schedule_templates(tenant.plan)
    created = 0
    for t in templates:
        db.add(ScheduleConfig(
            election_id=election_id,
            tenant_id=user["tenant_id"],
            name=t["name"],
            schedule_type=t["type"],
            fixed_times=t["times"],
            enabled=True,
            config=t.get("config", {}),
        ))
        created += 1

    await db.flush()
    return {"message": f"기본 스케줄 {created}개가 생성되었습니다", "count": created}


def _get_default_schedule_templates(plan: str) -> list[dict]:
    """요금제별 기본 스케줄. 기존 프로토타입의 14개 스케줄 기반."""
    basic = [
        {"name": "오전 뉴스 수집", "type": "news", "times": ["09:00"]},
        {"name": "오후 뉴스 수집", "type": "news", "times": ["18:00"]},
    ]

    pro = [
        {"name": "오전 브리핑", "type": "briefing", "times": ["09:00"],
         "config": {"sections": ["news", "sentiment", "trends", "alerts"]}},
        {"name": "뉴스 수집 (오전)", "type": "news", "times": ["09:30"]},
        {"name": "지역언론 수집 (오전)", "type": "news", "times": ["09:30"],
         "config": {"sources": ["local"]}},
        {"name": "커뮤니티 모니터링", "type": "community", "times": ["10:00"]},
        {"name": "검색 트렌드 (오전)", "type": "trends", "times": ["10:00"]},
        {"name": "경쟁자 약점 추적", "type": "news", "times": ["10:30"],
         "config": {"focus": "negative"}},
        {"name": "유튜브 모니터링 (오전)", "type": "youtube", "times": ["11:00"]},
        {"name": "오후 브리핑", "type": "briefing", "times": ["14:00"],
         "config": {"sections": ["news", "sentiment", "hot_issues"]}},
        {"name": "뉴스 수집 (오후)", "type": "news", "times": ["14:30"]},
        {"name": "지역언론 수집 (오후)", "type": "news", "times": ["14:30"],
         "config": {"sources": ["local"]}},
        {"name": "검색 트렌드 (오후)", "type": "trends", "times": ["15:30"]},
        {"name": "유튜브 모니터링 (오후)", "type": "youtube", "times": ["16:00"]},
        {"name": "일일 보고서", "type": "briefing", "times": ["18:00"],
         "config": {"type": "daily_full", "send_pdf": True, "send_telegram": True}},
    ]

    enterprise = pro + [
        {"name": "실시간 뉴스 (2시간)", "type": "news",
         "times": ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"]},
        {"name": "위기 감지 알림", "type": "alert",
         "times": ["09:00", "12:00", "15:00", "18:00"]},
    ]

    return {"basic": basic, "pro": pro, "enterprise": enterprise}.get(plan, basic)
