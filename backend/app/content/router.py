"""
ElectionPulse - Content Tools API
키워드 분석, 해시태그 추천, 블로그 태그, 선거법 체크, 콘텐츠 제안
"""
import structlog
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


# ── 선거법 조회 ──

@router.get("/election-law")
async def get_election_law_toc(db: AsyncSession = Depends(get_db)):
    """선거법 문서 목차."""
    from sqlalchemy import text as sql_text
    rows = (await db.execute(sql_text(
        "SELECT id, chapter, article_number, section_order, page_start, page_end "
        "FROM election_law_sections ORDER BY section_order"
    ))).all()
    return {
        "sections": [{
            "id": str(r[0]), "chapter": r[1], "article": r[2],
            "order": r[3], "page_start": r[4], "page_end": r[5],
        } for r in rows],
        "total": len(rows),
    }


@router.get("/election-law/search")
async def search_election_law(q: str, db: AsyncSession = Depends(get_db)):
    """선거법 키워드 검색."""
    from sqlalchemy import text as sql_text
    rows = (await db.execute(sql_text(
        "SELECT id, chapter, article_number, section_title, "
        "LEFT(content, 300) as content_preview, "
        "LEFT(guidelines, 300) as guide_preview, "
        "LEFT(examples, 300) as example_preview, "
        "keywords "
        "FROM election_law_sections "
        "WHERE content ILIKE :q OR guidelines ILIKE :q OR examples ILIKE :q "
        "OR chapter ILIKE :q OR article_number ILIKE :q "
        "ORDER BY section_order"
    ), {"q": f"%{q}%"})).all()
    return {
        "query": q,
        "results": [{
            "id": str(r[0]), "chapter": r[1], "article": r[2], "title": r[3],
            "content_preview": r[4], "guidelines_preview": r[5],
            "examples_preview": r[6], "keywords": r[7],
        } for r in rows],
        "count": len(rows),
    }


@router.get("/election-law/{section_id}")
async def get_election_law_section(section_id: str, db: AsyncSession = Depends(get_db)):
    """선거법 섹션 상세."""
    from sqlalchemy import text as sql_text
    row = (await db.execute(sql_text(
        "SELECT id, document_title, chapter, section_title, article_number, "
        "content, guidelines, examples, page_start, page_end, keywords, section_order "
        "FROM election_law_sections WHERE id = :sid"
    ), {"sid": section_id})).first()
    if not row:
        raise HTTPException(404, "섹션을 찾을 수 없습니다")
    return {
        "id": str(row[0]), "document_title": row[1], "chapter": row[2],
        "section_title": row[3], "article_number": row[4],
        "content": row[5], "guidelines": row[6], "examples": row[7],
        "page_start": row[8], "page_end": row[9],
        "keywords": row[10], "section_order": row[11],
    }


# ── 콘텐츠 상황 추천 (데이터 기반) ──

@router.get("/content-situations/{election_id}")
async def get_content_situations(
    election_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """현재 데이터 기반 콘텐츠 제작 상황 추천."""
    from sqlalchemy import text as sql_text
    from app.elections.models import NewsArticle, CommunityPost, YouTubeVideo, SearchTrend

    election, our, _ = await _load_election_data(db, user["tenant_id"], election_id)
    tid = user["tenant_id"]
    region_short = _get_short(election.region_sido)
    our_name = our.name if our else "후보"

    situations = []

    # 1. 트렌딩 이슈 (검색 트렌드 alerts에서)
    try:
        from app.collectors.keyword_tracker import KeywordTracker
        tracker = KeywordTracker()
        trends = await tracker.get_issue_trends(
            election.election_type or "superintendent", region_short, days=7
        )
        rising = [(k, v) for k, v in trends.items() if v.get("trend") == "rising"]
        for kw, data in rising[:3]:
            situations.append({
                "type": "trending",
                "icon": "🔥",
                "title": f"'{kw}' 검색량 급등 — 이슈 선점 콘텐츠",
                "topic": f"{kw} 관련 {our_name} 후보의 정책/입장",
                "reason": f"최근 7일 검색량 상승 중 (7d avg: {data.get('avg_7d', 0):.1f})",
                "priority": "high",
                "context": f"{region_short} 지역에서 '{kw}' 이슈가 급상승하고 있습니다. {our_name} 후보의 관련 공약이나 입장을 콘텐츠로 제작하여 이슈를 선점하세요.",
            })
    except Exception as e:
        structlog.get_logger().warning("content_situation_trending_error", error=str(e)[:200])

    # 2. 부정 뉴스 대응
    try:
        neg_news = (await db.execute(
            select(NewsArticle).where(
                NewsArticle.tenant_id == tid,
                NewsArticle.candidate_id == (our.id if our else None),
                NewsArticle.sentiment == "negative",
            ).order_by(NewsArticle.collected_at.desc()).limit(3)
        )).scalars().all()
        if neg_news:
            titles = [n.title[:40] for n in neg_news[:2]]
            situations.append({
                "type": "crisis",
                "icon": "⚠️",
                "title": f"부정 뉴스 {len(neg_news)}건 — 해명/대응 콘텐츠 필요",
                "topic": f"부정 보도 대응: {titles[0]}",
                "reason": f"최근 부정 뉴스 {len(neg_news)}건 감지",
                "priority": "high",
                "context": f"부정 보도 내용: {', '.join(titles)}. 사실 관계를 명확히 하고, {our_name} 후보의 입장을 정리한 대응 콘텐츠가 필요합니다.",
            })
    except Exception as e:
        structlog.get_logger().warning("content_situation_neg_news_error", error=str(e)[:200])

    # 3. 경쟁자 대비 갭 (커뮤니티에서 경쟁자가 다루는 이슈)
    try:
        candidates_q = (await db.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.tenant_id == tid,
                Candidate.enabled == True,
                Candidate.is_our_candidate == False,
            )
        )).scalars().all()

        for comp in candidates_q[:2]:
            comp_issues = (await db.execute(
                select(CommunityPost.issue_category, func.count()).where(
                    CommunityPost.candidate_id == comp.id,
                    CommunityPost.issue_category.isnot(None),
                ).group_by(CommunityPost.issue_category)
                .order_by(func.count().desc()).limit(1)
            )).first()
            if comp_issues and comp_issues[1] >= 2:
                situations.append({
                    "type": "gap",
                    "icon": "📊",
                    "title": f"{comp.name}이 '{comp_issues[0]}' 이슈 선점 중 — 대응 필요",
                    "topic": f"{comp_issues[0]} 관련 {our_name} 후보의 차별화 정책",
                    "reason": f"{comp.name} 커뮤니티 '{comp_issues[0]}' 게시글 {comp_issues[1]}건",
                    "priority": "medium",
                    "context": f"경쟁 후보 {comp.name}이 '{comp_issues[0]}' 이슈에서 커뮤니티 노출이 많습니다. {our_name} 후보의 관련 정책을 강조하는 콘텐츠로 대응하세요.",
                })
    except Exception as e:
        structlog.get_logger().warning("content_situation_gap_error", error=str(e)[:200])

    # 4. 일반 추천 (항상)
    from app.elections.korea_data import ELECTION_ISSUES
    type_label = ELECTION_ISSUES.get(election.election_type, {}).get("label", "선거")
    issues = ELECTION_ISSUES.get(election.election_type, {}).get("issues", [])

    situations.extend([
        {
            "type": "routine",
            "icon": "📝",
            "title": f"{our_name} 후보 핵심 공약 소개",
            "topic": f"{our_name} 후보 핵심 공약 정리",
            "reason": "기본 캠페인 콘텐츠",
            "priority": "medium",
            "context": f"{region_short} {type_label} 선거 {our_name} 후보의 핵심 공약을 유권자에게 쉽게 전달하는 콘텐츠입니다.",
        },
        {
            "type": "routine",
            "icon": "🎯",
            "title": f"{region_short} {issues[0] if issues else '교육'} 현황과 비전",
            "topic": f"{region_short} {issues[0] if issues else '교육'} 현황 분석과 {our_name} 후보의 비전",
            "reason": "핵심 이슈 콘텐츠",
            "priority": "medium",
            "context": f"{region_short} 지역의 {issues[0] if issues else '교육'} 현황을 데이터로 분석하고, {our_name} 후보의 해결 방안을 제시하는 콘텐츠입니다.",
        },
    ])

    # priority 순 정렬
    priority_order = {"high": 0, "medium": 1, "low": 2}
    situations.sort(key=lambda x: priority_order.get(x.get("priority", "low"), 9))

    return {"situations": situations, "our_candidate": our_name, "region": region_short}


# ── AI 콘텐츠 생성 ──

@router.post("/generate-content/{election_id}")
async def generate_content(
    election_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    content_type: str = "blog",
    topic: str = "",
    style: str = "formal",
    context: str = "",
):
    """AI 콘텐츠 생성 — Claude CLI로 블로그/SNS/유튜브 초안. context에 상황 데이터 포함."""
    import asyncio
    import shutil

    election, our, _ = await _load_election_data(db, user["tenant_id"], election_id)
    region_short = _get_short(election.region_sido)
    type_label = BLOG_TAG_CATEGORIES.get(election.election_type, {})

    claude_path = shutil.which("claude")
    if not claude_path:
        return {"error": "AI 생성 불가 (Claude CLI 미설치)", "content": None}

    # 콘텐츠 유형별 프롬프트
    type_prompts = {
        "blog": f"선거 캠프 블로그 글을 작성해주세요. 1500자 이내.\n- 제목 (클릭 유도)\n- 본문 (서론/본론/결론)\n- 해시태그 5개",
        "sns": f"선거 SNS 포스트를 작성해주세요. 300자 이내.\n- 간결하고 임팩트 있게\n- 해시태그 5개\n- 이모지 적절히 활용",
        "youtube": f"유튜브 영상 스크립트를 작성해주세요. 3분 분량.\n- 인트로 (시선 끌기)\n- 본 내용\n- 아웃트로 (구독 유도)\n- 제목 + 설명문 + 태그",
        "card": f"카드뉴스 콘텐츠를 작성해주세요. 5장 분량.\n- 각 장별 제목 + 본문 (50자 이내)\n- 마지막 장: 후보 소개 + CTA",
    }

    style_desc = "공식적이고 신뢰감 있는 톤" if style == "formal" else "친근하고 편안한 톤"

    context_block = ""
    if context:
        context_block = f"\n[현재 상황 데이터]\n{context}\n위 상황을 반영하여 콘텐츠를 작성하세요.\n"

    prompt = (
        f"당신은 {region_short} {election.election_type} 선거 캠프의 전문 콘텐츠 담당자입니다.\n"
        f"후보: {our.name if our else '후보'} ({our.party if our else ''})\n"
        f"지역: {region_short}\n"
        f"주제: {topic}\n"
        f"스타일: {style_desc}\n"
        f"{context_block}\n"
        f"{type_prompts.get(content_type, type_prompts['blog'])}\n\n"
        f"주의사항:\n"
        f"- 상대 후보 비방 금지 (공직선거법 제110조)\n"
        f"- 허위사실 금지 (제251조)\n"
        f"- 금품 제공 약속 금지 (제112조)\n"
        f"- AI 생성물은 [AI 활용] 표기 필요\n"
        f"- 구체적이고 실질적인 내용으로 작성\n\n"
        f"한국어로 작성해주세요."
    )

    try:
        proc = await asyncio.create_subprocess_exec(
            claude_path, "-p", prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=90)
        if proc.returncode == 0 and stdout:
            generated = stdout.decode("utf-8").strip()

            # 생성된 콘텐츠를 선거법 체크
            from app.content.compliance import ComplianceChecker
            checker = ComplianceChecker()
            compliance = checker.check_content(
                generated, content_type,
                election.election_date.isoformat() if election.election_date else None,
            )

            return {
                "content": generated,
                "content_type": content_type,
                "topic": topic,
                "compliance": compliance,
                "ai_generated": True,
            }
    except Exception as e:
        return {"error": str(e), "content": None, "ai_generated": False}

    return {"error": "AI 생성 실패", "content": None, "ai_generated": False}


# ── Debate Script ──

class DebateRequest(BaseModel):
    topics: list[str] = []
    opponent: Optional[str] = None
    style: str = "balanced"  # aggressive | defensive | balanced


@router.post("/debate-script/{election_id}")
async def generate_debate_script(
    election_id: str,
    body: DebateRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """AI 토론 대본 생성 — 상대 후보 약점 기반 공략 스크립트."""
    from app.services.debate_service import generate_debate_script as _gen
    return await _gen(
        db, user["tenant_id"], election_id,
        topics=body.topics or None,
        opponent_name=body.opponent,
        style=body.style,
    )


# ── Multi-tone Content ──

class MultiToneRequest(BaseModel):
    topic: str
    context: str = ""
    platforms: list[str] = ["instagram", "blog"]
    tones: list[str] = ["formal", "friendly"]


@router.post("/generate-multi-tone/{election_id}")
async def generate_multi_tone(
    election_id: str,
    body: MultiToneRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """하나의 정책을 플랫폼별 × 톤별 조합으로 동시 생성."""
    from app.content.tone_templates import generate_multi_tone_content
    return await generate_multi_tone_content(
        db, user["tenant_id"], election_id,
        topic=body.topic,
        context=body.context,
        platforms=body.platforms,
        tones=body.tones,
    )


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
    from app.common.election_access import get_election_tenant_ids, get_our_candidate_id

    # 공유 선거 지원 — election_id로만 조회
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        raise HTTPException(status_code=404, detail="선거를 찾을 수 없습니다")

    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id = await get_our_candidate_id(db, tenant_id, election_id)

    all_candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id, Candidate.tenant_id.in_(all_tids), Candidate.enabled == True,
        )
    )).scalars().all()

    # 중복 제거 + 우리 후보 동적 설정
    seen = set()
    candidates = []
    for c in all_candidates:
        if c.name not in seen:
            seen.add(c.name)
            if our_cand_id:
                c.is_our_candidate = (str(c.id) == our_cand_id)
            candidates.append(c)

    our = next((c for c in candidates if c.is_our_candidate), None)
    return election, our, candidates


def _get_short(sido: str | None) -> str:
    from app.elections.korea_data import REGIONS
    if not sido:
        return ""
    return REGIONS.get(sido, {}).get("short", sido[:2])
