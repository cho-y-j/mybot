"""
ElectionPulse - 과거 선거 + 여론조사 API
DB에 저장된 선관위/NESDC 데이터 조회
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.dependencies import CurrentUser

router = APIRouter()


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
