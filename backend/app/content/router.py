"""
ElectionPulse - Content Tools API
키워드 분석, 해시태그 추천, 블로그 태그, 선거법 체크, 콘텐츠 제안
"""
import structlog
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import select, func
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
    """콘텐츠 선거법 사전 검증 — AI 기반 정밀 분석."""
    election, _, _ = await _load_election_data(db, user["tenant_id"], election_id)

    result = await compliance_checker.check_with_ai(
        text=req.text,
        content_type=req.content_type,
        election_date=election.election_date.isoformat() if election.election_date else None,
        tenant_id=user["tenant_id"],
        db=db,
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
                NewsArticle.candidate_id == (our.id if our else None),
                NewsArticle.sentiment == "negative",
                NewsArticle.is_relevant == True,
            ).order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.collected_at.desc()).limit(3)
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
        from app.common.election_access import get_our_candidate_id as _goci
        _our_id = await _goci(db, tid, election_id)
        all_cands = (await db.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.enabled == True,
            )
        )).scalars().all()
        # election-shared: 우리 후보 제외 (tenant_elections 기준)
        candidates_q = [c for c in all_cands if not (_our_id and str(c.id) == _our_id)]

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
    purpose: str = "promote",
    target: str = "all",
):
    """AI 콘텐츠 생성 — 실제 수집 데이터 기반 + 목적/대상별 최적화."""
    from app.services.ai_service import call_claude_text

    election, our, _ = await _load_election_data(db, user["tenant_id"], election_id)
    region_short = _get_short(election.region_sido)

    # 콘텐츠 유형별 스펙
    type_specs = {
        "blog": {"label": "블로그 글", "chars": "1500~2000자",
                 "structure": "제목(SEO 키워드 포함, 25자 이내 클릭 유도) → 서론(문제 제기, 100자) → 본론 3단 소제목 (각 400~500자, 정책+근거 데이터) → 결론(행동 유도, 150자) → 해시태그 5~7개"},
        "sns": {"label": "SNS 포스트", "chars": "300자 이내",
                "structure": "첫 문장 훅(감정 유도) → 핵심 메시지 2~3문장 → 해시태그 5개. 이모지 3~5개 적절히."},
        "youtube": {"label": "유튜브 영상 스크립트", "chars": "900자 (3분 분량)",
                    "structure": "인트로 5초 훅 → 문제 제기 → 해결책(정책) → CTA(구독/좋아요) → 영상 제목 + 설명문 + 태그 20개"},
        "card": {"label": "카드뉴스 5장", "chars": "장당 제목 15자 + 본문 50자",
                 "structure": "1장(훅·질문) → 2~3장(문제 현황) → 4장(후보 해결책) → 5장(후보 소개 + CTA). 각 장마다 '===1장===' 구분"},
        "press": {"label": "보도자료", "chars": "1000자",
                  "structure": "제목 → 부제 → 리드(핵심 1문장, 육하원칙) → 본문(배경/내용/의미) → 후보 코멘트 인용문 → 문의처(캠프 연락처 형식)"},
        "defense": {"label": "해명/대응문", "chars": "800자",
                    "structure": "사안 요약(중립 서술) → 사실 관계 정리(번호 목록) → 우리 입장(논리적, 감정 배제) → 향후 계획. 반박 공격 금지, 팩트 중심"},
    }
    spec = type_specs.get(content_type, type_specs["blog"])

    purpose_map = {
        "promote": "우리 후보 강점·비전 부각. 긍정적·희망적 톤.",
        "attack": "경쟁 후보 약점을 팩트로만 지적 (비방·인신공격 금지, 데이터 기반 비교만).",
        "defend": "부정 보도/공격 대응. 침착하고 논리적, 감정 배제.",
        "policy": "구체 정책 설명. 쉬운 용어, 유권자 눈높이.",
        "inform": "정보 안내 (행사/공지/일정). 간결·정확.",
    }

    target_map = {
        "all": "전 연령 대상 — 보편적 관심사 중심.",
        "youth": "20~30대 대상 — 구어체, 트렌드 용어, 일자리·주거·교육비 이슈.",
        "senior": "50~60대 대상 — 격식체, 복지·건강·연금 이슈.",
        "parents": "학부모 대상 — 교육·돌봄·급식·안전. 맘카페 친근 톤.",
    }

    style_map = {
        "formal": "공식적·신뢰감 있는 격식체",
        "casual": "친근하고 편안한 구어체",
        "emotional": "감성적·공감 유도 톤",
        "technical": "전문적·정책 중심",
    }

    # 풍부한 컨텍스트 (RAG + NEC + 프로필 + 보고서 + 선거법)
    from app.services.rich_context import build_rich_context
    rich_ctx, citations = await build_rich_context(
        db, user["tenant_id"], str(election_id),
        topic=f"{topic} {spec['label']}",
        max_rag=10, max_reports=2, max_briefings=3,
        include_law=True,
    )

    # ── 통합 프롬프트 (하나의 명확한 구조) ──
    prompt = f"""당신은 {region_short} {election.election_type or ''} 선거 캠프의 10년 경력 프로 콘텐츠 라이터입니다.

[후보 정보]
- 우리 후보: {our.name if our else '후보'} ({our.party if our else '무소속'})
- 선거: {election.name} ({election.region_sido or ''} {election.region_sigungu or ''})

[작성 요청]
- 주제: {topic}
- 유형: {spec['label']} ({spec['chars']})
- 구조: {spec['structure']}
- 목적: {purpose_map.get(purpose, purpose_map['promote'])}
- 대상: {target_map.get(target, target_map['all'])}
- 톤: {style_map.get(style, style_map['formal'])}
{('- 추가 맥락: ' + context) if context else ''}

[참고 자료 — 반드시 이 데이터에 근거하여 작성]
{rich_ctx}

[작성 원칙]
1. **사실 기반**: 위 참고 자료의 수치/인용만 사용. 추측·상상 금지.
2. **데이터 부족 시**: WebSearch로 info.nec.go.kr 또는 공식 언론 확인 후 인용.
3. **출처 각주**: 주요 수치/주장 뒤에 [ref-xxx] (참고자료의 ID) 또는 [web](URL) 표시.
4. **선거법 준수 (절대 위반 금지)**:
   - 제110조 비방 금지: 경쟁 후보 인신공격·모욕·근거 없는 의혹 X (공약/정책 비교는 OK)
   - 제250조 허위사실 공표 금지: 확인 안 된 사실 단정 X
   - 제112조 기부행위 금지: "무료/경품/선물" 암시 X
   - 제82조의8: 본문 첫줄에 **[AI 활용]** 필수 표기 (위반 시 과태료 300만원)
5. **{spec['chars']} 엄수**: 길이 초과/부족 금지.
6. **구조 준수**: "{spec['structure']}" 순서대로 작성.
7. **숫자·사실 중심**: 추상적 미사여구 금지. 구체적 수치/날짜/지역명 명시.

[출력 형식]
- 콘텐츠 본문만 출력 (메타 설명/주석 없이)
- 마크다운 사용 가능 (제목은 ##, 강조는 **, 표 가능)
- 하단에 "---\\n참고: [ref-id1] [ref-id2]" 형식으로 사용한 출처 목록

지금 작성하세요."""

    # WebSearch 허용 — 내부 데이터 부족 시 실시간 검증
    generated = await call_claude_text(
        prompt, timeout=300, context="content_generation",
        tenant_id=user["tenant_id"], db=db, web_search=True,
    )

    if not generated:
        return {"error": "AI 생성 실패", "content": None, "ai_generated": False}

    # 선거법 체크
    from app.content.compliance import ComplianceChecker
    checker = ComplianceChecker()
    compliance = checker.check_content(
        generated, content_type,
        election.election_date.isoformat() if election.election_date else None,
    )

    # ── 생성 결과 DB 저장 + RAG 임베딩 (Report 테이블 재사용 — 챗/히스토리에서 활용) ──
    saved_id = None
    try:
        from app.elections.models import Report
        from datetime import date as _date
        # context 수집 중 트랜잭션 abort 가능성 → 먼저 rollback 보장
        try: await db.rollback()
        except Exception: pass
        report = Report(
            tenant_id=user["tenant_id"],
            election_id=election_id,
            report_type=content_type,  # blog | sns | youtube | card | press | defense
            title=f"[{content_type}] {topic[:200]}",
            content_text=generated,
            report_date=_date.today(),
        )
        db.add(report)
        await db.flush()
        saved_id = str(report.id)
        await db.commit()

        # RAG 임베딩 — 생성 콘텐츠도 이후 챗/생성에서 재활용 가능
        try:
            from app.services.embedding_service import store_embedding
            await store_embedding(
                db, user["tenant_id"], str(election_id),
                source_type="content",
                source_id=saved_id,
                title=f"[{content_type}] {topic[:100]}",
                content=(generated or "")[:1500],
            )
        except Exception as emb_err:
            import structlog
            structlog.get_logger().warning("content_embed_failed", error=str(emb_err)[:200])

        # NOTE: 생성 콘텐츠를 homepage에 자동 발행하지 않음 (사용자 요구).
        # AI 결과는 한 번 더 검토 후 수동 게시해야 함. 임베딩만 저장.
    except Exception as save_err:
        import structlog
        structlog.get_logger().warning("content_save_failed", error=str(save_err)[:200])

    return {
        "content": generated,
        "content_type": content_type,
        "topic": topic,
        "purpose": purpose,
        "target": target,
        "compliance": compliance,
        "citations": citations,
        "ai_generated": True,
        "saved_id": saved_id,
    }


# ── Debate Script ──

class DebateRequest(BaseModel):
    topics: list[str] = []
    opponent: Optional[str] = None
    style: str = "balanced"  # aggressive | defensive | balanced
    format: str = "broadcast"  # broadcast | speech | interview
    speech_minutes: int = 3  # 발언 시간 (분)


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
        debate_format=body.format,
        speech_minutes=body.speech_minutes,
    )


# ── Content History (생성된 콘텐츠/토론 재사용) ──

@router.get("/history/{election_id}")
async def get_content_history(
    election_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    content_types: Optional[str] = None,  # "blog,sns,debate_script" 형식
    limit: int = 30,
    offset: int = 0,
):
    """캠프가 이전에 생성한 콘텐츠/토론 대본 목록.
    report_type(content_type)으로 필터 가능. 챗/재사용/카드뉴스 재활용용.
    """
    from app.elections.models import Report
    from sqlalchemy import text as sql_text

    type_filter_sql = ""
    params = {
        "tid": user["tenant_id"],
        "eid": election_id,
        "limit": limit,
        "offset": offset,
    }
    if content_types:
        types = [t.strip() for t in content_types.split(",") if t.strip()]
        if types:
            type_filter_sql = "AND report_type = ANY(:types)"
            params["types"] = types

    # 일일/주간 브리핑 자동 생성물은 히스토리에서 제외 (사용자 수동 생성만)
    rows = (await db.execute(sql_text(f"""
        SELECT id, report_type, title, content_text, report_date, created_at
        FROM reports
        WHERE tenant_id = :tid AND election_id = :eid
          AND report_type NOT ILIKE '%brief%'
          AND report_type NOT ILIKE '%daily%'
          AND report_type NOT ILIKE '%weekly%'
          {type_filter_sql}
        ORDER BY created_at DESC
        LIMIT :limit OFFSET :offset
    """), params)).all()

    return {
        "items": [
            {
                "id": str(r.id),
                "content_type": r.report_type,
                "title": r.title,
                "preview": (r.content_text or "")[:300],
                "body": r.content_text or "",
                "date": r.report_date.isoformat() if r.report_date else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
        "total": len(rows),
        "has_more": len(rows) == limit,
    }


@router.get("/history-detail/{report_id}")
async def get_content_history_detail(
    report_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """히스토리 1건 상세 — 재편집용 전체 본문 반환."""
    from app.elections.models import Report
    from sqlalchemy import text as sql_text

    row = (await db.execute(sql_text("""
        SELECT id, report_type, title, content_text, report_date, created_at, election_id
        FROM reports
        WHERE id = :rid AND tenant_id = :tid
    """), {"rid": report_id, "tid": user["tenant_id"]})).first()

    if not row:
        raise HTTPException(404, "콘텐츠를 찾을 수 없습니다")

    return {
        "id": str(row.id),
        "content_type": row.report_type,
        "title": row.title,
        "body": row.content_text or "",
        "date": row.report_date.isoformat() if row.report_date else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "election_id": str(row.election_id) if row.election_id else None,
    }


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
    file: UploadFile = File(None),
):
    """파일 업로드 → 자동 파싱 → DB 저장 (Excel/CSV)."""
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
            Candidate.election_id == election_id, Candidate.enabled == True,
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
