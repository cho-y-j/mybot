"""
ElectionPulse - 과거 선거 + 여론조사 API
DB에 저장된 선관위/NESDC 데이터 조회
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.common.region_population import get_heatmap_stats, get_our_camp_aliases

router = APIRouter()


@router.get("/heatmap-stats")
async def heatmap_stats(
    election_id: Optional[str] = Query(None, description="현재 선거 id (자동 추출)"),
    election_year: Optional[int] = Query(None, description="과거 연도 직접 지정 시"),
    election_type: Optional[str] = Query(None, description="superintendent | governor | mayor 등"),
    region_sido: Optional[str] = Query(None, description="충청북도 등. 없으면 전국"),
    our_party: Optional[str] = Query(None, description="우리 진영 정당명 (콤마 구분 alias)"),
    user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """3단(시·도/시·군·구/읍·면·동) 영향력 히트맵 데이터.

    election_id 주면 그 선거의 region_sido / election_type 자동 추출.
    election_year는 직전 과거 선거(현재 -4년)로 자동 추정.

    GeoJSON은 별도로 schedules_v2 `/api/candidate-schedules/{election_id}/geojson`
    재사용. 이 endpoint는 stats만 (인구·선거인·후보별 표·gap·영향력).
    """
    from datetime import date as _date
    from uuid import UUID as _UUID
    from app.elections.models import Election

    auto_year: Optional[int] = None
    auto_type: Optional[str] = None
    auto_sido: Optional[str] = None
    auto_camp: Optional[str] = None
    auto_aliases: list[str] = []

    if election_id:
        try:
            elec = (await db.execute(
                select(Election).where(Election.id == _UUID(election_id))
            )).scalar_one_or_none()
            if elec:
                auto_type = elec.election_type
                auto_sido = elec.region_sido
                # 현재 선거 직전 같은 type 선거로 추정
                latest = (await db.execute(text("""
                    SELECT MAX(election_year) FROM election_results
                     WHERE region_sido = :rs AND election_type = :et
                       AND election_year <= :now_year
                """), {"rs": elec.region_sido, "et": elec.election_type, "now_year": _date.today().year})).scalar()
                auto_year = latest
                # 우리 진영 자동 추출 (party_alignment → historical_candidate_camps → party 룰)
                tid = user.get("tenant_id") if user else None
                if tid:
                    auto_camp, auto_aliases = await get_our_camp_aliases(db, election_id, str(tid))
        except Exception:
            pass

    final_year = election_year or auto_year
    final_type = election_type or auto_type
    final_sido = region_sido or auto_sido

    if not final_year or not final_type:
        return {"voter_ratio": 0.82, "sido": [], "sigungu": [], "dong": [], "error": "election_year+type required (or pass election_id)"}

    aliases = [a.strip() for a in (our_party.split(",") if our_party else []) if a.strip()] or auto_aliases or None
    result = await get_heatmap_stats(
        db=db,
        election_year=final_year,
        election_type=final_type,
        region_sido=final_sido,
        our_party_aliases=aliases,
        our_camp=auto_camp,
    )
    result["election_year_used"] = final_year
    result["election_type_used"] = final_type
    result["region_sido_used"] = final_sido
    result["our_camp_used"] = auto_camp
    return result


@router.get("/available-years")
async def available_years(
    election_id: Optional[str] = Query(None),
    election_type: Optional[str] = Query(None),
    region_sido: Optional[str] = Query(None),
    user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """heatmap-stats에서 선택 가능한 과거 선거 연도 목록.

    election_id 주면 그 선거의 region_sido/election_type 자동.
    """
    from uuid import UUID as _UUID
    from app.elections.models import Election

    f_type = election_type
    f_sido = region_sido
    if election_id:
        try:
            elec = (await db.execute(
                select(Election).where(Election.id == _UUID(election_id))
            )).scalar_one_or_none()
            if elec:
                f_type = f_type or elec.election_type
                f_sido = f_sido or elec.region_sido
        except Exception:
            pass

    if not f_type:
        return {"years": []}

    q = "SELECT DISTINCT election_year FROM election_results WHERE election_type = :t"
    params: dict = {"t": f_type}
    if f_sido:
        q += " AND region_sido = :rs"
        params["rs"] = f_sido
    q += " ORDER BY election_year DESC"

    rows = (await db.execute(text(q), params)).all()
    years = [r[0] for r in rows]
    return {"years": years, "default": years[0] if years else None}


@router.get("/election-history/by-region/{election_id}")
async def history_by_region(
    election_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """현재 선거와 같은 지역·유형의 역대 선거 결과 (당선자 + 상위 득표자)."""
    from app.elections.models import Election
    from uuid import UUID as _UUID

    election = (await db.execute(select(Election).where(Election.id == _UUID(election_id)))).scalar_one_or_none()
    if not election:
        return {"election": None, "results": [], "turnouts": [], "party_stats": {}}

    # 역대 결과 — 시군구별 저장이라 후보별 합산 후 최다득표자 순위
    results_rows = (await db.execute(text("""
        WITH totals AS (
            SELECT election_year, candidate_name,
                   MAX(party) AS party,
                   SUM(COALESCE(votes, 0)) AS total_votes
            FROM election_results
            WHERE region_sido = :sido AND election_type = :etype
            GROUP BY election_year, candidate_name
        ),
        year_sums AS (
            SELECT election_year, SUM(total_votes) AS year_total
            FROM totals GROUP BY election_year
        ),
        ranked AS (
            SELECT t.election_year, t.candidate_name, t.party, t.total_votes,
                   (t.total_votes * 100.0 / NULLIF(ys.year_total, 0)) AS vote_rate,
                   RANK() OVER (PARTITION BY t.election_year ORDER BY t.total_votes DESC) AS rk
            FROM totals t JOIN year_sums ys USING (election_year)
        )
        SELECT election_year, candidate_name, party, vote_rate, (rk = 1) AS is_winner
        FROM ranked
        ORDER BY election_year DESC, vote_rate DESC
    """), {"sido": election.region_sido, "etype": election.election_type})).fetchall()

    # 연도별 그룹핑 (상위 5명씩)
    by_year: dict = {}
    for r in results_rows:
        by_year.setdefault(r.election_year, []).append({
            "candidate": r.candidate_name,
            "party": r.party or "무소속",
            "vote_rate": float(r.vote_rate) if r.vote_rate is not None else None,
            "is_winner": bool(r.is_winner),
        })
    years = sorted(by_year.keys(), reverse=True)[:4]
    grouped = [{"year": y, "candidates": by_year[y][:5]} for y in years]

    # 투표율 (같은 지역·유형, total 카테고리, 최근 5회)
    turnouts_rows = (await db.execute(text("""
        SELECT election_year, turnout_rate
        FROM voter_turnout
        WHERE region_sido = :sido AND election_type = :etype AND category = 'total'
        ORDER BY election_year DESC
        LIMIT 5
    """), {"sido": election.region_sido, "etype": election.election_type})).fetchall()
    turnouts = [{"year": t.election_year, "turnout_rate": float(t.turnout_rate)} for t in turnouts_rows]

    # 정당 우세도
    party_stats = {}
    for r in results_rows:
        if r.is_winner and r.party:
            party_stats[r.party] = party_stats.get(r.party, 0) + 1

    return {
        "election": {
            "id": str(election.id), "name": election.name,
            "region": f"{election.region_sido or ''} {election.region_sigungu or ''}".strip(),
            "type": election.election_type,
        },
        "results": grouped,
        "turnouts": turnouts,
        "party_stats": party_stats,
    }


@router.get("/election-history")
async def get_election_history(
    election_type: str = "local",
    db: AsyncSession = Depends(get_db),
):
    """역대 선거 결과 (선관위 데이터)."""
    result = await db.execute(
        text("""
            SELECT election_type, election_number, election_year, candidate_name, vote_rate
            FROM election_results
            WHERE election_type LIKE :etype
            ORDER BY election_year
        """),
        {"etype": f"%{election_type}%"},
    )
    rows = result.fetchall()

    return {
        "count": len(rows),
        "data": [
            {
                "type": r[0], "number": r[1], "year": r[2],
                "name": r[3], "turnout": r[4],
            }
            for r in rows
        ],
    }


@router.get("/polls")
async def get_polls(
    limit: int = 50,
    party: str = None,
    db: AsyncSession = Depends(get_db),
):
    """여론조사 데이터 (NESDC 데이터)."""
    query = "SELECT id, survey_org, survey_date, sample_size, margin_of_error, method, results, source_url FROM surveys ORDER BY survey_date DESC LIMIT :limit"
    result = await db.execute(text(query), {"limit": limit})
    rows = result.fetchall()

    data = []
    for r in rows:
        results = r[6] if isinstance(r[6], dict) else {}
        item = {
            "id": str(r[0]),
            "org": r[1],
            "date": r[2].isoformat() if r[2] else None,
            "sample_size": r[3],
            "margin_of_error": r[4],
            "method": r[5],
            "results": results,
            "source": r[7],
        }

        # 특정 정당 필터
        if party and party not in str(results):
            continue

        data.append(item)

    return {"count": len(data), "polls": data}


@router.get("/polls/trend")
async def get_poll_trend(
    party: str = "더불어민주당",
    days: int = 90,
    db: AsyncSession = Depends(get_db),
):
    """정당별 지지율 추이."""
    result = await db.execute(
        text("""
            SELECT survey_date, results, survey_org
            FROM surveys
            WHERE survey_date >= CURRENT_DATE - :days
            ORDER BY survey_date
        """),
        {"days": days},
    )
    rows = result.fetchall()

    trend = []
    for r in rows:
        results = r[1] if isinstance(r[1], dict) else {}
        if party in results:
            trend.append({
                "date": r[0].isoformat() if r[0] else None,
                "value": results[party],
                "org": r[2],
            })

    return {"party": party, "count": len(trend), "trend": trend}


@router.get("/polls/latest")
async def get_latest_polls(
    count: int = 10,
    db: AsyncSession = Depends(get_db),
):
    """최신 여론조사."""
    result = await db.execute(
        text("SELECT survey_org, survey_date, sample_size, method, results FROM surveys ORDER BY survey_date DESC LIMIT :cnt"),
        {"cnt": count},
    )
    rows = result.fetchall()

    return {
        "polls": [
            {
                "org": r[0], "date": r[1].isoformat() if r[1] else None,
                "sample": r[2], "method": r[3],
                "results": r[4] if isinstance(r[4], dict) else {},
            }
            for r in rows
        ]
    }


@router.get("/polls/summary")
async def get_poll_summary(db: AsyncSession = Depends(get_db)):
    """여론조사 종합 요약 (최근 한 달 평균)."""
    result = await db.execute(text("""
        SELECT results FROM surveys
        WHERE survey_date >= CURRENT_DATE - 30
        ORDER BY survey_date DESC
    """))
    rows = result.fetchall()

    if not rows:
        return {"message": "최근 30일 여론조사 데이터 없음"}

    # 정당별 평균 계산
    party_totals: dict[str, list[float]] = {}
    for r in rows:
        results = r[0] if isinstance(r[0], dict) else {}
        for party, value in results.items():
            if isinstance(value, (int, float)) and value > 0:
                party_totals.setdefault(party, []).append(value)

    summary = {}
    for party, values in party_totals.items():
        summary[party] = {
            "avg": round(sum(values) / len(values), 1),
            "min": round(min(values), 1),
            "max": round(max(values), 1),
            "count": len(values),
        }

    # 정렬 (평균 높은 순)
    sorted_summary = dict(sorted(summary.items(), key=lambda x: -x[1]["avg"]))

    return {
        "period": "최근 30일",
        "total_polls": len(rows),
        "parties": sorted_summary,
    }
