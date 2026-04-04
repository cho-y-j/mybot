"""
ElectionPulse - Data Collection API
수집 실행 (즉시/스케줄), 상태 조회
"""
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.elections.models import (
    ScheduleConfig, ScheduleRun, NewsArticle, CommunityPost, YouTubeVideo, Candidate,
)

router = APIRouter()


@router.get("/{election_id}/keyword-volumes")
async def get_keyword_volumes(
    election_id: UUID,
    user: CurrentUser,
    extra_keywords: str = "",
    db: AsyncSession = Depends(get_db),
):
    """
    키워드별 실제 월간 검색량 조회.
    후보 이름 + 선거 이슈 + 사용자 추가 키워드의 실제 검색수를 보여줌.
    """
    from app.collectors.keyword_volume import KeywordVolumeAPI
    from app.elections.models import Election, Keyword
    from app.elections.korea_data import ELECTION_ISSUES, REGIONS

    tid = user["tenant_id"]

    # 후보 + 선거 정보
    candidates_q = (await db.execute(
        select(Candidate).where(Candidate.election_id == election_id, Candidate.tenant_id == tid, Candidate.enabled == True)
    )).scalars().all()
    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()

    # 조회할 키워드 목록 구성
    kw_list = [c.name for c in candidates_q]  # 후보 이름

    if election:
        region_short = REGIONS.get(election.region_sido, {}).get("short", "")
        issues = ELECTION_ISSUES.get(election.election_type, {}).get("issues", [])
        kw_list.extend(issues[:10])  # 상위 이슈 키워드
        if region_short:
            kw_list.append(f"{region_short} 교육감" if election.election_type == "superintendent" else f"{region_short} 시장")

    # 사용자 추가 키워드
    if extra_keywords:
        kw_list.extend([k.strip() for k in extra_keywords.split(",") if k.strip()])

    # 중복 제거
    kw_list = list(dict.fromkeys(kw_list))

    # 실제 검색량 조회 — 요청한 키워드만 정확히 조회 (연관 키워드 쓰레기 제거)
    vol_api = KeywordVolumeAPI()
    kw_set = set(kw_list[:20])
    raw_volumes = await vol_api.get_keyword_volumes(kw_list[:20])

    # 내가 요청한 키워드만 필터 (API가 반환하는 관련없는 연관 키워드 제거)
    volumes = [v for v in raw_volumes if v["keyword"] in kw_set]

    # 카테고리 분류
    cand_names = [c.name for c in candidates_q]
    candidate_vols = [v for v in volumes if v["keyword"] in cand_names]
    issue_vols = [v for v in volumes if v["keyword"] not in cand_names]

    # 해시태그 추천 (선거 관련 키워드만)
    recommended_hashtags = []
    for v in volumes:
        if v["total"] >= 10:
            recommended_hashtags.append({
                "tag": f"#{v['keyword']}",
                "volume": v["total"],
                "competition": v["competition"],
                "recommendation": "강추" if v["total"] >= 1000 else "추천" if v["total"] >= 100 else "보통",
            })

    return {
        "total_keywords": len(volumes),
        "candidates": candidate_vols,
        "issues": issue_vols,
        "all": volumes,
        "recommended_hashtags": sorted(recommended_hashtags, key=lambda x: -x["volume"]),
    }


@router.get("/{election_id}/related-keywords")
async def get_related_keywords(
    election_id: UUID,
    keyword: str,
    user: CurrentUser,
    filter_relevant: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """
    특정 키워드의 연관 키워드 + 검색량.
    filter_relevant=True면 선거 유형에 맞는 것만 필터링.
    """
    from app.collectors.keyword_volume import KeywordVolumeAPI
    from app.elections.models import Election
    from app.elections.korea_data import ELECTION_ISSUES

    vol_api = KeywordVolumeAPI()
    related = await vol_api.get_related_keywords(keyword, limit=50)

    if filter_relevant:
        election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
        if election:
            # 선거 유형별 관련 키워드로 필터
            issues = ELECTION_ISSUES.get(election.election_type, {}).get("issues", [])
            # 후보 이름도 포함
            candidates_q = (await db.execute(
                select(Candidate).where(Candidate.election_id == election_id, Candidate.enabled == True)
            )).scalars().all()
            cand_names = [c.name for c in candidates_q]

            # 관련성 필터: 키워드에 이슈/후보/선거 관련 단어가 포함되어야 함
            relevance_words = set(issues + cand_names + [
                "선거", "후보", "공약", "투표", "교육", "학교", "학생", "교사",
                "정책", "개혁", "지지", "여론", keyword,
            ])

            related = [r for r in related if any(w in r["keyword"] for w in relevance_words)]

    return {
        "keyword": keyword,
        "related_count": len(related),
        "related": related,
    }


@router.get("/{election_id}/search-keyword")
async def search_single_keyword(
    election_id: UUID,
    keyword: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    단일 키워드 검색량 조회 — 사용자가 직접 입력.
    """
    from app.collectors.keyword_volume import KeywordVolumeAPI

    vol_api = KeywordVolumeAPI()
    results = await vol_api.get_keyword_volumes([keyword])

    # 정확히 입력한 키워드만 반환
    exact = [r for r in results if r["keyword"] == keyword]
    related = [r for r in results if r["keyword"] != keyword][:10]

    return {
        "keyword": keyword,
        "result": exact[0] if exact else {"keyword": keyword, "pc": 0, "mobile": 0, "total": 0, "competition": "없음"},
        "related_keywords": related,
    }


@router.post("/{election_id}/collect-now")
async def collect_now(
    election_id: UUID,
    collect_type: str = "news",
    user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """
    즉시 수집 실행 (Celery 없이 동기 실행).
    collect_type: news | youtube | community | all
    """
    from app.collectors.instant import (
        collect_news_now, collect_youtube_now,
        collect_community_now, collect_all_now,
    )

    tid = user["tenant_id"]

    if collect_type == "all":
        result = await collect_all_now(db, tid, str(election_id))
        total = result["collected"]
        results = result.get("details", [result])
    else:
        results = []
        if collect_type in ("news",):
            r = await collect_news_now(db, tid, str(election_id))
            results.append(r)
        if collect_type in ("community",):
            r = await collect_community_now(db, tid, str(election_id))
            results.append(r)
        if collect_type in ("youtube",):
            r = await collect_youtube_now(db, tid, str(election_id))
            results.append(r)
        total = sum(r.get("collected", 0) for r in results)

    # 텔레그램 자동 보고 (연결되어 있으면)
    if total > 0:
        try:
            from app.telegram_service.reporter import send_collection_report
            await send_collection_report(db, tid, str(election_id), collect_type, total)
        except Exception as e:
            pass  # 텔레그램 미연결 시 무시

    return {"message": f"수집 완료: {total}건", "results": results}


@router.get("/{election_id}/status")
async def get_collection_status(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """수집 현황: 후보별 수집 데이터 수."""
    tid = user["tenant_id"]

    candidates = (await db.execute(
        select(Candidate).where(Candidate.election_id == election_id, Candidate.tenant_id == tid)
    )).scalars().all()

    status = []
    for c in candidates:
        news_count = (await db.execute(
            select(func.count()).where(NewsArticle.candidate_id == c.id)
        )).scalar()
        yt_count = (await db.execute(
            select(func.count()).where(YouTubeVideo.candidate_id == c.id)
        )).scalar()
        community_count = (await db.execute(
            select(func.count()).where(CommunityPost.candidate_id == c.id)
        )).scalar()

        status.append({
            "candidate": c.name,
            "candidate_id": str(c.id),
            "is_our_candidate": c.is_our_candidate,
            "news": news_count,
            "youtube": yt_count,
            "community": community_count,
            "total": news_count + yt_count + community_count,
        })

    # 최근 스케줄 실행
    recent_runs = (await db.execute(
        select(ScheduleRun).where(ScheduleRun.tenant_id == tid)
        .order_by(ScheduleRun.started_at.desc()).limit(5)
    )).scalars().all()

    return {
        "candidates": status,
        "total_items": sum(s["total"] for s in status),
        "recent_runs": [
            {"status": r.status, "items": r.items_collected, "at": r.started_at.isoformat()}
            for r in recent_runs
        ],
    }


@router.get("/{election_id}/keyword-trends")
async def get_keyword_trends(
    election_id: UUID,
    user: CurrentUser,
    days: int = 30,
    db: AsyncSession = Depends(get_db),
):
    """실시간 키워드 검색 트렌드 (네이버 DataLab)."""
    from app.collectors.keyword_tracker import KeywordTracker
    from app.elections.models import Election

    tid = user["tenant_id"]

    # 후보 이름 + 선거 정보
    candidates_q = (await db.execute(
        select(Candidate).where(Candidate.election_id == election_id, Candidate.tenant_id == tid, Candidate.enabled == True)
    )).scalars().all()

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()

    cand_names = [c.name for c in candidates_q]
    region_short = ""
    election_type = "superintendent"
    if election:
        from app.elections.korea_data import REGIONS
        region_short = REGIONS.get(election.region_sido, {}).get("short", "")
        election_type = election.election_type

    tracker = KeywordTracker()

    # 후보별 + 이슈별 병렬 수집
    import asyncio
    cand_task = tracker.get_candidate_trends(cand_names, days)
    issue_task = tracker.get_issue_trends(election_type, region_short, days)

    cand_trends, issue_trends = await asyncio.gather(cand_task, issue_task)

    # 위기/기회 감지
    alerts = []
    our = next((c for c in candidates_q if c.is_our_candidate), None)
    if our and our.name in cand_trends:
        our_data = cand_trends[our.name]
        max_ratio = max((v["latest"] for v in cand_trends.values()), default=0)

        if max_ratio > 0:
            our_pct = our_data["latest"] / max_ratio * 100
            if our_pct < 30:
                alerts.append({"level": "critical", "message": f"{our.name} 검색량 심각 부족 ({our_pct:.0f}% 수준)"})
            elif our_pct < 60:
                alerts.append({"level": "warning", "message": f"{our.name} 검색량 경쟁자 대비 부족 ({our_pct:.0f}%)"})

        if our_data["trend"] == "falling":
            alerts.append({"level": "warning", "message": f"{our.name} 검색량 하락 추세"})

    # 이슈 중 급상승 감지
    for issue, data in issue_trends.items():
        if data["trend"] == "rising":
            alerts.append({"level": "opportunity", "message": f"'{issue}' 검색량 급상승 — 이슈 선점 기회"})

    return {
        "candidates": cand_trends,
        "issues": issue_trends,
        "alerts": alerts,
        "period": f"최근 {days}일",
    }


@router.post("/{election_id}/collect-trends")
async def collect_trends_now(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """검색 트렌드 즉시 수집 → DB 저장."""
    from app.collectors.keyword_tracker import collect_and_store_trends
    from app.elections.models import Election

    tid = user["tenant_id"]
    candidates_q = (await db.execute(
        select(Candidate).where(Candidate.election_id == election_id, Candidate.tenant_id == tid, Candidate.enabled == True)
    )).scalars().all()

    election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()

    cand_names = [c.name for c in candidates_q]
    region_short = ""
    etype = "superintendent"
    if election:
        from app.elections.korea_data import REGIONS
        region_short = REGIONS.get(election.region_sido, {}).get("short", "")
        etype = election.election_type

    result = await collect_and_store_trends(db, tid, str(election_id), cand_names, etype, region_short)
    return {"message": f"트렌드 수집 완료: {result['stored']}건", **result}


@router.get("/{election_id}/news")
async def get_collected_news(
    election_id: UUID,
    user: CurrentUser,
    limit: int = 50,
    candidate_id: str = None,
    sentiment: str = None,
    db: AsyncSession = Depends(get_db),
):
    """수집된 뉴스 목록 (필터 지원)."""
    query = select(NewsArticle, Candidate.name).join(
        Candidate, NewsArticle.candidate_id == Candidate.id
    ).where(
        NewsArticle.tenant_id == user["tenant_id"],
        NewsArticle.election_id == election_id,
    ).order_by(NewsArticle.collected_at.desc()).limit(limit)

    if candidate_id:
        query = query.where(NewsArticle.candidate_id == candidate_id)
    if sentiment:
        query = query.where(NewsArticle.sentiment == sentiment)

    rows = (await db.execute(query)).all()

    return [
        {
            "id": str(n.id),
            "title": n.title,
            "url": n.url,
            "source": n.source,
            "summary": n.summary,
            "sentiment": n.sentiment,
            "sentiment_score": n.sentiment_score,
            "candidate": cand_name,
            "date": (n.published_at or n.collected_at).strftime("%Y-%m-%d") if (n.published_at or n.collected_at) else None,
            "collected_at": n.collected_at.isoformat() if n.collected_at else None,
        }
        for n, cand_name in rows
    ]
