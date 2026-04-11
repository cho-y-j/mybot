"""
ElectionPulse - Smart Onboarding API
지역 + 선거유형 선택 → 키워드/커뮤니티/스케줄 자동 생성
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, func, select as sa_select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.elections.korea_data import (
    auto_generate_setup, get_regions_list,
    get_election_types, get_parties_list, REGIONS,
)
from app.elections.models import (
    Election, Candidate, Keyword, ScheduleConfig,
    NewsArticle, CommunityPost, YouTubeVideo, ScheduleRun,
)
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
    기본 스케줄 템플릿 — 수집 직후 브리핑 통합 (3회).

    07:00  수집 + 오전 브리핑 (밤사이 데이터 + 출근 전 보고)
    13:00  수집 + 오후 브리핑 (오전 활동 + 점심 후 확인)
    18:00  수집 + 일일 종합 보고서 (퇴근 시간 도착)

    각 시간에 수집 후 즉시 AI 분석 + 보고서 생성 + 텔레그램 발송.
    """
    return [
        {
            "name": "오전 수집+브리핑 (07:00)",
            "schedule_type": "full_with_briefing",
            "fixed_times": ["07:00"],
            "config": {"briefing_type": "morning", "send_telegram": True},
        },
        {
            "name": "오후 수집+브리핑 (13:00)",
            "schedule_type": "full_with_briefing",
            "fixed_times": ["13:00"],
            "config": {"briefing_type": "afternoon", "send_telegram": True},
        },
        {
            "name": "일일 종합 보고서 (18:00)",
            "schedule_type": "full_with_briefing",
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

    # 5. 스케줄 생성 — 캠프별 시간 오프셋 자동 분산 (Claude API 부하 분산)
    import hashlib
    offset_min = int(hashlib.md5(str(tid).encode()).hexdigest()[:4], 16) % 15  # 0~14분 오프셋

    def _apply_offset(time_str: str) -> str:
        h, m = map(int, time_str.split(':'))
        m += offset_min
        if m >= 60:
            h += 1
            m -= 60
        return f"{h:02d}:{m:02d}"

    schedule_templates = _get_default_schedule_templates()
    sched_count = 0
    for s in schedule_templates:
        adjusted_times = [_apply_offset(t) for t in s["fixed_times"]]
        db.add(ScheduleConfig(
            election_id=election.id,
            tenant_id=tid,
            name=s["name"].replace(s["fixed_times"][0], adjusted_times[0]) if s["fixed_times"] else s["name"],
            schedule_type=s["schedule_type"],
            fixed_times=adjusted_times,
            enabled=True,
            config=s.get("config", {}),
        ))
        sched_count += 1

    await db.flush()

    # 6. 즉시 첫 수집 + 자동 부트스트랩 (백그라운드 task)
    # 수집 → 분석 → AI 리포트까지 순차 자동 실행. 진행 상태는 analysis_cache에 저장되어
    # GET /elections/{id}/bootstrap-status 로 폴링 가능.
    try:
        import asyncio
        from app.collectors.instant import collect_all_now
        from app.elections.bootstrap import bootstrap_campaign

        election_id_str = str(election.id)
        tenant_id_str = str(tid)

        async def _bg_collect_and_bootstrap():
            from app.database import async_session_factory
            import structlog
            log = structlog.get_logger()
            try:
                await _write_bootstrap_status(
                    tenant_id_str, election_id_str, "collecting", 10,
                    "데이터 수집 중 (뉴스·블로그·유튜브)"
                )
                # 1단계: 데이터 수집
                async with async_session_factory() as bg_db:
                    await collect_all_now(bg_db, tenant_id_str, election_id_str)
                    log.info("onboarding_collect_done", election_id=election_id_str)

                await _write_bootstrap_status(
                    tenant_id_str, election_id_str, "analyzing", 60,
                    "AI 분석 중 (Sonnet + Opus 2단계)"
                )
                # 2단계: 분석/리포트 자동 부트스트랩
                async with async_session_factory() as bg_db2:
                    boot = await bootstrap_campaign(bg_db2, tenant_id_str, election_id_str)
                    await bg_db2.commit()
                    log.info("onboarding_bootstrap_done", election_id=election_id_str, result=boot)

                await _write_bootstrap_status(
                    tenant_id_str, election_id_str, "done", 100,
                    "완료 — 모든 페이지 준비됨"
                )
            except Exception as e:
                log.error("bg_first_collect_failed", error=str(e))
                await _write_bootstrap_status(
                    tenant_id_str, election_id_str, "failed", 0,
                    f"실패: {str(e)[:150]}"
                )

        asyncio.create_task(_bg_collect_and_bootstrap())
        # 부트스트랩 시작 상태 즉시 기록
        await _write_bootstrap_status(
            tenant_id_str, election_id_str, "starting", 5,
            "초기 데이터 수집 준비 중"
        )
    except Exception as e:
        import structlog
        structlog.get_logger().warning("onboarding_first_collect_failed", error=str(e))

    # 7. 과거 선거 데이터 자동 로드 (선관위 API)
    history_result = {"records_imported": 0}
    try:
        from app.collectors.nec_api import fetch_and_store_history
        history_result = await fetch_and_store_history(
            db_session=db,
            region_sido=req.sido,
            election_type=req.election_type,
            tenant_id=tid,
        )
        await db.flush()
    except Exception as e:
        import structlog
        structlog.get_logger().warning("onboarding_history_failed", error=str(e))

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
            "history_records": history_result.get("records_imported", 0),
        },
    }


# ─────────────────── BOOTSTRAP STATUS ───────────────────

async def _write_bootstrap_status(
    tenant_id: str, election_id: str, phase: str, progress: int, message: str,
) -> None:
    """analysis_cache에 부트스트랩 상태 기록. 실패해도 조용히 통과."""
    from app.database import async_session_factory
    import json
    try:
        async with async_session_factory() as db:
            import uuid
            data = {"phase": phase, "progress": progress, "message": message}
            data_json = json.dumps(data, ensure_ascii=False)
            await db.execute(text(
                "INSERT INTO analysis_cache "
                "  (id, tenant_id, election_id, cache_type, data, "
                "   analysis_type, analysis_date, result_data, created_at) "
                "VALUES (:id, :tid, :eid, 'bootstrap_status', :data, "
                "        'bootstrap_status', CURRENT_DATE, :data, NOW()) "
                "ON CONFLICT (tenant_id, election_id, cache_type) DO UPDATE SET "
                "  data = EXCLUDED.data, "
                "  result_data = EXCLUDED.result_data, "
                "  created_at = NOW()"
            ), {
                "id": str(uuid.uuid4()),
                "tid": tenant_id, "eid": election_id,
                "data": data_json,
            })
            await db.commit()
    except Exception:
        pass  # analysis_cache 테이블이 없거나 실패해도 무시


@router.get("/elections/{election_id}/bootstrap-status")
async def get_bootstrap_status(
    election_id: str,
    user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    """신규 가입 부트스트랩 진행 상태. 프론트엔드 setup 페이지에서 폴링.

    Returns: {
      "phase": "starting|collecting|analyzing|done|failed",
      "progress": 0~100,
      "message": str,
      "counts": {news, community, youtube, analyzed_news, analyzed_community, analyzed_youtube},
      "schedule_runs": int,
      "last_run": ISO datetime,
    }
    """
    tid = user["tenant_id"]

    # 캐시된 상태 읽기
    phase = "unknown"
    progress = 0
    message = ""
    try:
        row = (await db.execute(text(
            "SELECT data, created_at FROM analysis_cache "
            "WHERE tenant_id = :tid AND election_id = :eid AND cache_type = 'bootstrap_status' "
            "ORDER BY created_at DESC LIMIT 1"
        ), {"tid": str(tid), "eid": election_id})).first()
        if row:
            import json as _json
            data = row[0] if isinstance(row[0], dict) else _json.loads(row[0])
            phase = data.get("phase", "unknown")
            progress = data.get("progress", 0)
            message = data.get("message", "")
    except Exception:
        pass

    # 실시간 카운트 (캐시된 상태와 교차 검증)
    async def _count(q):
        try:
            return (await db.execute(q)).scalar() or 0
        except Exception:
            return 0

    news_total = await _count(sa_select(func.count(NewsArticle.id)).where(
        NewsArticle.tenant_id == tid, NewsArticle.election_id == election_id,
    ))
    community_total = await _count(sa_select(func.count(CommunityPost.id)).where(
        CommunityPost.tenant_id == tid, CommunityPost.election_id == election_id,
    ))
    youtube_total = await _count(sa_select(func.count(YouTubeVideo.id)).where(
        YouTubeVideo.tenant_id == tid, YouTubeVideo.election_id == election_id,
    ))
    news_analyzed = await _count(sa_select(func.count(NewsArticle.id)).where(
        NewsArticle.tenant_id == tid, NewsArticle.election_id == election_id,
        NewsArticle.ai_analyzed_at.isnot(None),
    ))
    community_analyzed = await _count(sa_select(func.count(CommunityPost.id)).where(
        CommunityPost.tenant_id == tid, CommunityPost.election_id == election_id,
        CommunityPost.ai_analyzed_at.isnot(None),
    ))
    youtube_analyzed = await _count(sa_select(func.count(YouTubeVideo.id)).where(
        YouTubeVideo.tenant_id == tid, YouTubeVideo.election_id == election_id,
        YouTubeVideo.ai_analyzed_at.isnot(None),
    ))

    # ScheduleRun 최신 1건 (수집 진행 여부 증거)
    last_run = None
    run_count = 0
    try:
        rr = (await db.execute(sa_select(ScheduleRun).where(
            ScheduleRun.tenant_id == tid,
        ).order_by(ScheduleRun.started_at.desc()).limit(1))).scalar_one_or_none()
        if rr:
            last_run = rr.started_at.isoformat() if rr.started_at else None
        run_count = await _count(sa_select(func.count(ScheduleRun.id)).where(
            ScheduleRun.tenant_id == tid,
        ))
    except Exception:
        pass

    # 상태 추론 보정: 캐시가 없어도 DB 카운트로 진행도 derive
    if phase == "unknown":
        if news_total + community_total + youtube_total == 0:
            phase = "starting"
            progress = 5
            message = "수집 대기 중"
        elif news_analyzed + community_analyzed + youtube_analyzed == 0:
            phase = "collecting"
            progress = 30
            message = f"수집 완료 {news_total + community_total + youtube_total}건, AI 분석 대기"
        else:
            phase = "analyzing"
            progress = 70
            message = f"AI 분석 진행 중 ({news_analyzed + community_analyzed + youtube_analyzed}건 완료)"

    return {
        "phase": phase,
        "progress": progress,
        "message": message,
        "counts": {
            "news": news_total,
            "community": community_total,
            "youtube": youtube_total,
            "analyzed_news": news_analyzed,
            "analyzed_community": community_analyzed,
            "analyzed_youtube": youtube_analyzed,
        },
        "schedule_runs": run_count,
        "last_run": last_run,
    }
