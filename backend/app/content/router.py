"""
ElectionPulse - Content Tools API
키워드 분석, 해시태그 추천, 블로그 태그, 선거법 체크, 콘텐츠 제안
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.common.dependencies import CurrentUser
from app.elections.models import Election, Candidate
from app.content.keyword_engine import (
    generate_hashtags, generate_blog_tags, generate_content_suggestions,
    BLOG_TAG_CATEGORIES,
)
from app.content.compliance import ComplianceChecker
from app.content.importer import import_excel, import_csv

router = APIRouter()
compliance_checker = ComplianceChecker()


@router.get("/hashtags/{election_id}")
async def get_hashtags(
    election_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """해시태그 자동 추천 (캠페인/이슈/SNS/블로그/유튜브)."""
    election, our, _ = await _load_election_data(db, user["tenant_id"], election_id)

    hashtags = generate_hashtags(
        election_type=election.election_type,
        region_short=_get_short(election.region_sido),
        candidate_name=our.name if our else "후보",
        candidate_party=our.party if our else None,
        sigungu=election.region_sigungu,
    )

    return {
        "election": election.name,
        "candidate": our.name if our else None,
        **hashtags,
        "total_count": sum(len(v) for v in hashtags.values()),
    }


@router.get("/blog-tags/{election_id}")
async def get_blog_tags(
    election_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """블로그 관리용 태그 추천 (카테고리별)."""
    election, our, _ = await _load_election_data(db, user["tenant_id"], election_id)

    tags = generate_blog_tags(
        election_type=election.election_type,
        region_short=_get_short(election.region_sido),
        candidate_name=our.name if our else "후보",
    )

    return {
        "election_type": election.election_type,
        "categories": tags,
        "category_count": len(tags),
        "total_tags": sum(len(v) for v in tags.values()),
    }


@router.get("/suggestions/{election_id}")
async def get_content_suggestions(
    election_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """콘텐츠 제안 (블로그/SNS/유튜브 주제 추천)."""
    election, our, _ = await _load_election_data(db, user["tenant_id"], election_id)

    suggestions = generate_content_suggestions(
        election_type=election.election_type,
        region_short=_get_short(election.region_sido),
        candidate_name=our.name if our else "후보",
        candidate_party=our.party if our else None,
    )

    return {"suggestions": suggestions, "count": len(suggestions)}


class ComplianceCheckRequest(BaseModel):
    text: str
    content_type: str = "general"  # general | sms | blog | sns | youtube


@router.post("/check-compliance/{election_id}")
async def check_compliance(
    election_id: str,
    req: ComplianceCheckRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """콘텐츠 선거법 사전 검증."""
    election, _, _ = await _load_election_data(db, user["tenant_id"], election_id)

    result = compliance_checker.check_content(
        text=req.text,
        content_type=req.content_type,
        election_date=election.election_date.isoformat(),
    )

    return result


@router.get("/keyword-categories")
async def get_keyword_categories(election_type: str = "superintendent"):
    """선거 유형별 키워드 카테고리 목록."""
    categories = BLOG_TAG_CATEGORIES.get(election_type, {})
    return {
        "election_type": election_type,
        "categories": {
            cat: {"keywords": kws, "count": len(kws)}
            for cat, kws in categories.items()
        },
    }


# ── File Upload ──

@router.post("/upload")
async def upload_file(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    file: "UploadFile" = None,
):
    """파일 업로드 → 자동 파싱 → DB 저장 (Excel/CSV)."""
    from fastapi import UploadFile, File
    import tempfile, os

    if not file:
        raise HTTPException(status_code=400, detail="파일을 선택해주세요")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".xlsx", ".xls", ".csv"]:
        raise HTTPException(status_code=400, detail="지원 형식: xlsx, csv")

    # 임시 파일 저장
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        if ext in [".xlsx", ".xls"]:
            result = await import_excel(tmp_path, user["tenant_id"], db)
        else:
            result = await import_csv(tmp_path, user["tenant_id"], db)

        return {
            "filename": file.filename,
            **result,
        }
    finally:
        os.unlink(tmp_path)


# ── Helper ──

async def _load_election_data(db, tenant_id, election_id):
    election = (await db.execute(
        select(Election).where(Election.id == election_id, Election.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not election:
        raise HTTPException(status_code=404, detail="선거를 찾을 수 없습니다")

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id, Candidate.tenant_id == tenant_id, Candidate.enabled == True,
        )
    )).scalars().all()

    our = next((c for c in candidates if c.is_our_candidate), None)
    return election, our, candidates


def _get_short(sido: str | None) -> str:
    from app.elections.korea_data import REGIONS
    if not sido:
        return ""
    return REGIONS.get(sido, {}).get("short", sido[:2])
