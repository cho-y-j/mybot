"""
ElectionPulse - SNS Multi-tone Template Engine
플랫폼별 × 톤별 콘텐츠 동시 생성.
"""
import asyncio
import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai_service import call_claude_text
from app.content.compliance import ComplianceChecker

_compliance = ComplianceChecker()

logger = structlog.get_logger()

PLATFORM_SPECS = {
    "instagram": {"name": "인스타그램", "max_chars": 2200, "hashtags": 30, "emoji": True, "note": "짧은 문장, 줄바꿈 많이, 이모지 적극 사용"},
    "facebook": {"name": "페이스북", "max_chars": 500, "hashtags": 5, "emoji": True, "note": "친근하면서도 정보 전달력 있는 중간 길이"},
    "twitter": {"name": "X(트위터)", "max_chars": 280, "hashtags": 3, "emoji": False, "note": "극도로 간결, 핵심만, 임팩트 있게"},
    "blog": {"name": "블로그", "max_chars": 1500, "hashtags": 10, "emoji": False, "note": "논리적 구조, 소제목 포함, SEO 키워드 자연스럽게"},
    "cafe": {"name": "맘카페/커뮤니티", "max_chars": 800, "hashtags": 5, "emoji": True, "note": "~요체, 경험담 형식, 공감 유도"},
}

TONE_PROMPTS = {
    "formal": "공식적이고 신뢰감 있는 어조. 격식체(~합니다, ~입니다) 사용",
    "friendly": "친구에게 말하듯 편안하고 따뜻한 어조. ~요체 사용, 살짝 수다스러운 느낌",
    "humor": "재치 있고 가벼운 어조. 적절한 유머와 비유 포함. 너무 가볍지 않게",
    "emotional": "감동적이고 진심이 느껴지는 어조. 스토리텔링 형식, 공감 포인트 강조",
}


async def generate_multi_tone_content(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    topic: str,
    context: str = "",
    platforms: list[str] = None,
    tones: list[str] = None,
) -> dict:
    """플랫폼 × 톤 조합별 콘텐츠 동시 생성. (매번 새로 생성 — 캐싱 안 함)"""
    from app.elections.models import Election
    from sqlalchemy import select

    platforms = platforms or ["instagram", "blog"]
    tones = tones or ["formal", "friendly"]

    from app.elections.models import Candidate

    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"error": "선거 정보 없음", "results": []}

    our = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id == tenant_id,
            Candidate.is_our_candidate == True,
        )
    )).scalar_one_or_none()

    # 해시태그 생성
    from app.content.keyword_engine import generate_hashtags
    hashtags = generate_hashtags(
        election.election_type or "superintendent",
        election.region_sido or "",
        our.name if our else "후보",
        candidate_party=our.party if our else None,
    )

    # 조합별 병렬 생성
    tasks = []
    combos = []
    for platform in platforms:
        for tone in tones:
            spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS["blog"])
            tone_desc = TONE_PROMPTS.get(tone, TONE_PROMPTS["formal"])

            prompt = (
                f"다음 주제에 대해 SNS 콘텐츠를 작성하세요.\n\n"
                f"주제: {topic}\n"
                f"{'추가 맥락: ' + context if context else ''}\n\n"
                f"플랫폼: {spec['name']}\n"
                f"글자 수 제한: {spec['max_chars']}자 이내\n"
                f"톤앤매너: {tone_desc}\n"
                f"작성 가이드: {spec['note']}\n"
                f"{'이모지를 적극 활용하세요.' if spec['emoji'] else '이모지 사용을 최소화하세요.'}\n\n"
                f"규칙:\n"
                f"- 반드시 {spec['max_chars']}자 이내로 작성\n"
                f"- 해시태그 {spec['hashtags']}개 이내로 본문 끝에 포함\n"
                f"- 선거 관련 콘텐츠이므로 공직선거법 위반 소지가 없도록\n"
                f"- [AI 생성물] 표기를 본문 첫줄에 포함\n"
                f"- 콘텐츠 본문만 출력 (설명이나 주석 없이)"
            )

            tasks.append(call_claude_text(
                prompt, timeout=60,
                context=f"multi_tone_{platform}_{tone}",
                tenant_id=tenant_id, db=db,
            ))
            combos.append({"platform": platform, "tone": tone, "spec": spec})

    results_raw = await asyncio.gather(*tasks, return_exceptions=True)

    # 결과 조합
    results = []
    for i, (combo, raw) in enumerate(zip(combos, results_raw)):
        content = raw if isinstance(raw, str) else None
        compliance = None

        if content:
            # 글자수 제한 초과 시 자동 트림
            max_chars = combo["spec"]["max_chars"]
            if len(content) > max_chars:
                content = content[:max_chars - 3] + "..."

            compliance = _compliance.check_content(content, election_date=election.election_date.isoformat() if election and election.election_date else None)

        results.append({
            "platform": combo["platform"],
            "platform_name": combo["spec"]["name"],
            "tone": combo["tone"],
            "tone_name": {"formal": "공식", "friendly": "친근", "humor": "유머", "emotional": "감동"}.get(combo["tone"], combo["tone"]),
            "content": content,
            "char_count": len(content) if content else 0,
            "max_chars": combo["spec"]["max_chars"],
            "compliance": compliance,
            "ai_generated": content is not None,
        })

    return {
        "topic": topic,
        "total": len(results),
        "generated": sum(1 for r in results if r["ai_generated"]),
        "results": results,
        "hashtag_suggestions": hashtags,
    }
