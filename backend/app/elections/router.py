"""
ElectionPulse - Election Management API
선거/후보자/키워드 CRUD — 고객이 직접 경쟁자 추가 가능
"""
from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
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
    """내 테넌트의 선거 목록 조회 (공유 선거 포함)."""
    from sqlalchemy import or_, text as sql_text
    tid = user.get("tenant_id")

    # tenant_id 없는 사용자 (superadmin 등) → 빈 목록
    if not tid:
        return []

    # 자기 tenant 선거 + tenant_elections 매핑된 선거
    shared_ids = (await db.execute(sql_text(
        "SELECT election_id FROM tenant_elections WHERE tenant_id = :tid"
    ), {"tid": str(tid)})).scalars().all()

    conditions = [Election.tenant_id == tid]
    if shared_ids:
        conditions.append(Election.id.in_(shared_ids))

    query = select(Election).where(or_(*conditions))
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
    """후보자 목록 조회 (election-shared, 우리 후보는 tenant_elections 기준)."""
    from app.common.election_access import list_election_candidates
    tid = user["tenant_id"]
    candidates = await list_election_candidates(db, election_id, tenant_id=tid, enabled_only=False)
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
    """후보자 추가 — election-shared: (election_id, name) upsert.

    동일 name 이 이미 있으면 새로 만들지 않고 tenant_elections 매핑만 갱신.
    """
    # 선거 접근 권한 (election-shared: tenant_elections 기반)
    from app.common.election_access import can_access_election, get_or_create_candidate
    tid = user["tenant_id"]
    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
    if not election:
        raise HTTPException(status_code=404, detail="선거를 찾을 수 없습니다")
    if not await can_access_election(db, tid, election_id):
        raise HTTPException(status_code=403, detail="선거 접근 권한이 없습니다")

    # 후보자 수 제한 확인
    from app.auth.models import Tenant
    from sqlalchemy import text as sql_text
    tenant = await db.execute(select(Tenant).where(Tenant.id == tid))
    tenant = tenant.scalar_one()
    count = await db.execute(
        select(func.count()).where(Candidate.election_id == election_id)
    )
    if count.scalar() >= tenant.max_candidates and not user["is_superadmin"]:
        raise HTTPException(
            status_code=403,
            detail=f"요금제 한도 초과: 최대 {tenant.max_candidates}명 후보자",
        )

    keywords = req.search_keywords or [req.name]
    if req.name not in keywords:
        keywords.insert(0, req.name)

    candidate, created = await get_or_create_candidate(
        db, election_id, req.name,
        tenant_id=tid,
        party=req.party,
        party_alignment=req.party_alignment,
        role=req.role,
        is_our_candidate=req.is_our_candidate,
        search_keywords=keywords,
        homonym_filters=req.homonym_filters,
        sns_links=req.sns_links,
        career_summary=req.career_summary,
    )

    # "우리 후보"는 tenant_elections에 기록 (election-shared)
    if req.is_our_candidate:
        await db.execute(sql_text(
            "INSERT INTO tenant_elections (tenant_id, election_id, our_candidate_id) "
            "VALUES (:tid, :eid, :cid) "
            "ON CONFLICT (tenant_id, election_id) DO UPDATE SET our_candidate_id = EXCLUDED.our_candidate_id"
        ), {"tid": str(tid), "eid": str(election_id), "cid": str(candidate.id)})

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
    """후보자 수정 — election-shared: 같은 선거의 다른 캠프와 공유됨에 주의."""
    from app.common.election_access import can_access_election
    tid = user["tenant_id"]
    if not await can_access_election(db, tid, election_id):
        raise HTTPException(status_code=403, detail="선거 접근 권한이 없습니다")

    result = await db.execute(
        select(Candidate).where(
            Candidate.id == candidate_id,
            Candidate.election_id == election_id,
        )
    )
    candidate = result.scalar_one_or_none()
    if not candidate:
        raise HTTPException(status_code=404, detail="후보자를 찾을 수 없습니다")

    update_data = req.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(candidate, key, value)

    candidate.updated_at = datetime.now(timezone.utc)
    await db.commit()

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
    """후보자 삭제 — election-shared이므로 다른 캠프도 영향받음. 내 우리 후보는 삭제 불가."""
    from app.common.election_access import can_access_election, get_our_candidate_id
    tid = user["tenant_id"]
    if not await can_access_election(db, tid, election_id):
        raise HTTPException(status_code=403, detail="선거 접근 권한이 없습니다")

    result = await db.execute(
        select(Candidate).where(
            Candidate.id == candidate_id,
            Candidate.election_id == election_id,
        )
    )
    candidate = result.scalar_one_or_none()
    if not candidate:
        raise HTTPException(status_code=404, detail="후보자를 찾을 수 없습니다")

    my_cand_id = await get_our_candidate_id(db, tid, election_id)
    if my_cand_id and str(candidate.id) == my_cand_id:
        raise HTTPException(status_code=400, detail="우리 후보는 삭제할 수 없습니다")

    # election-shared 안전장치: 다른 캠프가 우리 후보로 사용 중이면 삭제 거부
    from sqlalchemy import text as _sqltext
    other_camp = (await db.execute(_sqltext(
        "SELECT COUNT(*) FROM tenant_elections "
        "WHERE our_candidate_id = :cid AND tenant_id != :tid"
    ), {"cid": str(candidate_id), "tid": str(tid)})).scalar() or 0
    if other_camp > 0:
        raise HTTPException(status_code=409, detail="다른 캠프가 이 후보를 우리 후보로 사용 중이라 삭제할 수 없습니다")

    # 의존 row 정리 (FK 12개)
    cid = str(candidate_id)
    # election-shared raw: candidate_id만 NULL (데이터는 다른 캠프와 공유 → 보존)
    for tbl in ("news_articles", "community_posts", "youtube_videos"):
        await db.execute(_sqltext(f"UPDATE {tbl} SET candidate_id = NULL WHERE candidate_id = :cid"), {"cid": cid})
    # camp-private 관점/집계: DELETE
    for tbl in ("news_strategic_views", "community_strategic_views", "youtube_strategic_views",
                "keywords", "sentiment_daily", "ad_campaigns"):
        await db.execute(_sqltext(f"DELETE FROM {tbl} WHERE candidate_id = :cid"), {"cid": cid})
    # tenant_elections.our_candidate_id 정리 (위 보호 로직에서 자기 캠프만 남았음)
    await db.execute(_sqltext(
        "UPDATE tenant_elections SET our_candidate_id = NULL WHERE our_candidate_id = :cid"
    ), {"cid": cid})
    # candidate_profiles, candidate_schedules는 ON DELETE CASCADE → 자동
    await db.delete(candidate)
    await db.commit()


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


class ScheduleUpdateBody(BaseModel):
    enabled: Optional[bool] = None
    fixed_times: Optional[list[str]] = None
    name: Optional[str] = None
    schedule_type: Optional[str] = None
    config: Optional[dict] = None


@router.put("/{election_id}/schedules/{schedule_id}")
async def update_schedule(
    election_id: UUID,
    schedule_id: UUID,
    body: ScheduleUpdateBody,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """스케줄 수정 (활성/비활성, 시간 변경, 이름 등)."""
    result = await db.execute(
        select(ScheduleConfig).where(
            ScheduleConfig.id == schedule_id,
            ScheduleConfig.tenant_id == user["tenant_id"],
        )
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="스케줄을 찾을 수 없습니다")

    enabled = body.enabled
    fixed_times = body.fixed_times
    name = body.name

    if enabled is not None:
        schedule.enabled = enabled
    if fixed_times is not None:
        schedule.fixed_times = fixed_times
    if body.schedule_type is not None:
        schedule.schedule_type = body.schedule_type
    if body.config is not None:
        schedule.config = body.config
    if name is not None:
        schedule.name = name

    await db.commit()
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
    await db.commit()


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
    """요금제별 기본 스케줄. CLAUDE.md 2.2.5 규정 (onboarding과 동일).

      07:00  full_with_briefing (morning)  — 수집+DB통계 브리핑
      13:00  full_with_briefing (afternoon) — 수집+DB통계 브리핑
      17:30  full_collection  — 보고서 전 데이터 확보
      18:00  briefing (daily) — Opus 16섹션 전략 보고서 + PDF
      월 09:00  weekly_report  — 주간 전략 보고서
    """
    standard = [
        {"name": "오전 수집+브리핑 (07:00)", "type": "full_with_briefing", "times": ["07:00"],
         "config": {"briefing_type": "morning", "send_telegram": True}},
        {"name": "오후 수집+브리핑 (13:00)", "type": "full_with_briefing", "times": ["13:00"],
         "config": {"briefing_type": "afternoon", "send_telegram": True}},
        {"name": "마감 수집 (17:30)", "type": "full_collection", "times": ["17:30"],
         "config": {}},
        {"name": "일일 종합 보고서 (18:00)", "type": "briefing", "times": ["18:00"],
         "config": {"briefing_type": "daily", "send_telegram": True}},
        {"name": "주간 전략 보고서 (월 09:00)", "type": "weekly_report", "times": ["09:00"],
         "config": {"day_of_week": "monday"}},
    ]

    basic = [
        {"name": "마감 수집 (17:30)", "type": "full_collection", "times": ["17:30"], "config": {}},
        {"name": "일일 종합 보고서 (18:00)", "type": "briefing", "times": ["18:00"],
         "config": {"briefing_type": "daily", "send_telegram": True}},
    ]

    enterprise = standard + [
        {"name": "추가 수집 (10:30)", "type": "full_collection", "times": ["10:30"], "config": {}},
        {"name": "추가 수집 (15:30)", "type": "full_collection", "times": ["15:30"], "config": {}},
    ]

    return {"basic": basic, "pro": standard, "enterprise": enterprise}.get(plan, standard)
