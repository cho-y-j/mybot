"""
ElectionPulse - Smart Onboarding API
지역 + 선거유형 선택 → 키워드/커뮤니티/스케줄 자동 생성
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.elections.korea_data import (
    auto_generate_setup, get_regions_list,
    get_election_types, get_parties_list, REGIONS,
)
from app.elections.models import Election, Candidate, Keyword, ScheduleConfig
from app.auth.models import Tenant

router = APIRouter()


class SmartSetupRequest(BaseModel):
    """스마트 온보딩 요청 — 이것만 입력하면 나머지 자동."""
    election_name: str
    election_type: str       # superintendent | mayor | congressional | governor | council
    sido: str                # "충청북도"
    sigungu: Optional[str] = None  # "청주시"
    election_date: str       # "2026-06-03"

    # 우리 후보
    our_name: str
    our_party: Optional[str] = None

    # 경쟁 후보 (선택 — 나중에 추가 가능)
    competitors: list[dict] = []  # [{"name": "윤건영", "party": "보수"}, ...]


def _get_default_schedule_templates() -> list[dict]:
    """
    기본 스케줄 템플릿 — 06/08/13/14/17/18 패턴.

    06:00  Full collection (news + community + youtube + trends + comments)
    08:00  AI analysis → Morning briefing → Telegram
    08:30~13:00  Alert check every 30 min (built-in via celery beat)
    13:00  Full collection
    14:00  AI analysis → Afternoon briefing → Telegram
    14:30~17:00  Alert check continues
    17:00  Full collection
    18:00  AI analysis → Daily report → Telegram
    """
    return [
        {
            "name": "오전 수집 (06:00)",
            "schedule_type": "full_collection",
            "fixed_times": ["06:00"],
            "config": {"description": "뉴스+커뮤니티+유튜브+트렌드+댓글 전체 수집"},
        },
        {
            "name": "오전 브리핑 (08:00)",
            "schedule_type": "briefing",
            "fixed_times": ["08:00"],
            "config": {"briefing_type": "morning", "send_telegram": True},
        },
        {
            "name": "오후 수집 (13:00)",
            "schedule_type": "full_collection",
            "fixed_times": ["13:00"],
            "config": {"description": "뉴스+커뮤니티+유튜브+트렌드+댓글 전체 수집"},
        },
        {
            "name": "오후 브리핑 (14:00)",
            "schedule_type": "briefing",
            "fixed_times": ["14:00"],
            "config": {"briefing_type": "afternoon", "send_telegram": True},
        },
        {
            "name": "마감 수집 (17:00)",
            "schedule_type": "full_collection",
            "fixed_times": ["17:00"],
            "config": {"description": "뉴스+커뮤니티+유튜브+트렌드+댓글 전체 수집"},
        },
        {
            "name": "일일 보고서 (18:00)",
            "schedule_type": "briefing",
            "fixed_times": ["18:00"],
            "config": {"briefing_type": "daily", "send_telegram": True},
        },
    ]


@router.get("/regions")
async def list_regions():
    """시도/시군구 목록 (프론트엔드 셀렉트박스용)."""
    return get_regions_list()


@router.get("/election-types")
async def list_election_types():
    """선거 유형 목록."""
    return get_election_types()


@router.get("/parties")
async def list_parties():
    """정당 목록."""
    return get_parties_list()


@router.post("/preview")
async def preview_setup(req: SmartSetupRequest):
    """
    자동 셋팅 미리보기 — 실제 저장 전 확인.
    사용자가 키워드/스케줄을 수정할 수 있게.
    """
    setup = auto_generate_setup(
        sido=req.sido,
        sigungu=req.sigungu,
        election_type=req.election_type,
        our_candidate_name=req.our_name,
        our_candidate_party=req.our_party,
        competitors=req.competitors,
    )

    # Use the correct default schedule templates
    schedules = _get_default_schedule_templates()

    return {
        "message": "자동 생성된 설정을 확인하세요. 수정 후 저장할 수 있습니다.",
        "election": {
            "name": req.election_name,
            "type": req.election_type,
            "type_label": setup["election_type_label"],
            "region": f"{req.sido} {req.sigungu or ''}".strip(),
            "date": req.election_date,
        },
        "candidates": [
            {"name": req.our_name, "party": req.our_party, "is_ours": True,
             "keywords": setup["candidate_keywords"].get(req.our_name, [])},
        ] + [
            {"name": c["name"], "party": c.get("party"), "is_ours": False,
             "keywords": setup["candidate_keywords"].get(c["name"], [])}
            for c in req.competitors
        ],
        "monitoring_keywords": setup["monitoring_keywords"],
        "community_targets": setup["community_targets"],
        "local_media": setup["local_media"],
        "search_trend_keywords": setup["search_trend_keywords"],
        "schedules": schedules,
    }


@router.post("/apply")
async def apply_setup(
    req: SmartSetupRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    자동 셋팅 적용 — 선거 + 후보 + 키워드 + 스케줄 한 번에 생성.
    고객이 "시작하기" 버튼 하나로 모든 것이 설정됨.

    스케줄은 06/08/13/14/17/18 패턴으로 자동 생성.
    """
    from datetime import date as date_type

    tid = user["tenant_id"]
    if not tid:
        raise HTTPException(status_code=400, detail="먼저 조직을 생성하세요")

    setup = auto_generate_setup(
        sido=req.sido,
        sigungu=req.sigungu,
        election_type=req.election_type,
        our_candidate_name=req.our_name,
        our_candidate_party=req.our_party,
        competitors=req.competitors,
    )

    # 1. 선거 생성
    election = Election(
        tenant_id=tid,
        name=req.election_name,
        election_type=req.election_type,
        region_sido=req.sido,
        region_sigungu=req.sigungu,
        election_date=date_type.fromisoformat(req.election_date),
    )
    db.add(election)
    await db.flush()

    # 2. 우리 후보
    our = Candidate(
        election_id=election.id,
        tenant_id=tid,
        name=req.our_name,
        party=req.our_party,
        is_our_candidate=True,
        priority=1,
        search_keywords=setup["candidate_keywords"].get(req.our_name, [req.our_name]),
    )
    db.add(our)
    await db.flush()
    election.our_candidate_id = our.id

    # 3. 경쟁 후보
    comp_count = 0
    for i, c in enumerate(req.competitors):
        cand = Candidate(
            election_id=election.id,
            tenant_id=tid,
            name=c["name"],
            party=c.get("party"),
            is_our_candidate=False,
            priority=i + 2,
            search_keywords=setup["candidate_keywords"].get(c["name"], [c["name"]]),
            homonym_filters=c.get("homonym_filters", []),
        )
        db.add(cand)
        comp_count += 1

    # 4. 모니터링 키워드
    kw_count = 0
    for kw in setup["monitoring_keywords"]:
        db.add(Keyword(
            election_id=election.id,
            tenant_id=tid,
            word=kw,
            category="auto",
        ))
        kw_count += 1

    # 커뮤니티 키워드
    for kw in setup["community_targets"]:
        db.add(Keyword(
            election_id=election.id,
            tenant_id=tid,
            word=kw,
            category="community",
        ))
        kw_count += 1

    # 5. 스케줄 생성 — 06/08/13/14/17/18 패턴
    schedule_templates = _get_default_schedule_templates()
    sched_count = 0
    for s in schedule_templates:
        db.add(ScheduleConfig(
            election_id=election.id,
            tenant_id=tid,
            name=s["name"],
            schedule_type=s["schedule_type"],
            fixed_times=s["fixed_times"],
            enabled=True,
            config=s.get("config", {}),
        ))
        sched_count += 1

    await db.flush()

    return {
        "message": "설정이 완료되었습니다! 분석을 시작할 수 있습니다.",
        "election_id": str(election.id),
        "summary": {
            "election": req.election_name,
            "region": f"{setup['region_short']} {req.sigungu or ''}".strip(),
            "type": setup["election_type_label"],
            "our_candidate": req.our_name,
            "competitors": comp_count,
            "keywords": kw_count,
            "schedules": sched_count,
            "schedule_pattern": "06:00 수집 → 08:00 오전 브리핑 → 13:00 수집 → 14:00 오후 브리핑 → 17:00 수집 → 18:00 일일 보고서",
            "local_media": len(setup["local_media"]),
            "community_targets": len(setup["community_targets"]),
        },
    }
