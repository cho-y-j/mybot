"""
ElectionPulse - Debate Script Service
AI 기반 토론 대본 생성.
상대 후보 약점 + 팩트 데이터 + 선거법 검증.
"""
import structlog
from datetime import date, timedelta
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.elections.models import (
    Election, Candidate, NewsArticle, Survey,
)
from app.services.ai_service import call_claude
from app.content.compliance import ComplianceChecker

_compliance = ComplianceChecker()

logger = structlog.get_logger()


async def generate_debate_script(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    topics: list[str] | None = None,
    opponent_name: str | None = None,
    style: str = "balanced",
    debate_format: str = "broadcast",
    speech_minutes: int = 3,
) -> dict:
    """
    토론 대본 생성.
    Returns: {opening, key_points[], rebuttals[], closing, compliance, ai_generated}
    """
    from app.services.cache_service import get_cache, set_cache

    # 캐시 확인 (12시간 TTL)
    cache_key = f"debate_{opponent_name or 'auto'}_{style}_{debate_format}_{speech_minutes}m"
    cached = await get_cache(db, tenant_id, election_id, cache_key, max_age_hours=12)
    if cached:
        return cached

    from app.common.election_access import get_election_tenant_ids, get_our_candidate_id
    all_tids = await get_election_tenant_ids(db, election_id)
    our_cand_id = await get_our_candidate_id(db, tenant_id, election_id)

    # 데이터 수집
    election = (await db.execute(
        select(Election).where(Election.id == election_id)
    )).scalar_one_or_none()
    if not election:
        return {"error": "선거 정보 없음"}

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.tenant_id.in_(all_tids),
            Candidate.enabled == True,
        )
    )).scalars().all()

    # 멀티테넌트: 우리 후보 동적 설정
    for c in candidates:
        if our_cand_id:
            c.is_our_candidate = (str(c.id) == our_cand_id)

    our = next((c for c in candidates if c.is_our_candidate), None)
    if not our:
        return {"error": "우리 후보가 설정되지 않았습니다"}

    # 상대 후보 특정
    opponent = None
    if opponent_name:
        opponent = next((c for c in candidates if c.name == opponent_name and not c.is_our_candidate), None)
    if not opponent:
        # 가장 위협적인 경쟁자 자동 선택 (뉴스 노출 최다)
        competitors = [c for c in candidates if not c.is_our_candidate]
        if competitors:
            comp_news = []
            for c in competitors:
                cnt = (await db.execute(
                    select(func.count()).where(
                        NewsArticle.candidate_id == c.id,
                        func.date(NewsArticle.collected_at) >= date.today() - timedelta(days=30),
                    )
                )).scalar() or 0
                comp_news.append((c, cnt))
            comp_news.sort(key=lambda x: -x[1])
            opponent = comp_news[0][0] if comp_news else None

    if not opponent:
        return {"error": "경쟁 후보가 없습니다"}

    # 상대 후보 공격 포인트 (strategic_quadrant=opportunity — AI가 '경쟁자 약점'으로 분류한 것 우선)
    # Fallback: sentiment=negative (AI 분류 없는 오래된 데이터)
    since = date.today() - timedelta(days=90)
    opponent_neg_news = (await db.execute(
        select(NewsArticle).where(
            NewsArticle.candidate_id == opponent.id,
            func.date(NewsArticle.collected_at) >= since,
            (NewsArticle.strategic_quadrant == "opportunity") |
            ((NewsArticle.strategic_quadrant.is_(None)) & (NewsArticle.sentiment == "negative")),
        ).order_by(
            NewsArticle.strategic_quadrant.asc().nullslast(),  # opportunity 있는 것 우선
            NewsArticle.published_at.desc().nullslast(),
            NewsArticle.collected_at.desc(),
        ).limit(10)
    )).scalars().all()

    # 우리 후보 강점 근거 (strategic_quadrant=strength — AI가 '우리 강점'으로 분류한 것)
    our_pos_news = (await db.execute(
        select(NewsArticle).where(
            NewsArticle.candidate_id == our.id,
            func.date(NewsArticle.collected_at) >= since,
            (NewsArticle.strategic_quadrant == "strength") |
            ((NewsArticle.strategic_quadrant.is_(None)) & (NewsArticle.sentiment == "positive")),
        ).order_by(
            NewsArticle.strategic_quadrant.asc().nullslast(),
            NewsArticle.published_at.desc().nullslast(),
            NewsArticle.collected_at.desc(),
        ).limit(5)
    )).scalars().all()

    # 여론조사
    latest_survey = (await db.execute(
        select(Survey).where(
            Survey.tenant_id.in_(all_tids),
        ).order_by(Survey.survey_date.desc()).limit(1)
    )).scalar_one_or_none()

    # 토론 주제 (미지정 시 부정 뉴스 기반 자동 선택)
    if not topics:
        from app.elections.korea_data import ELECTION_ISSUES
        issue_list = ELECTION_ISSUES.get(election.election_type or "superintendent", {}).get("issues", [])
        topics = issue_list[:3] if issue_list else ["교육 정책", "지역 발전", "행정 투명성"]

    # 커뮤니티 최근 이슈 수집
    community_issues = []
    try:
        from app.elections.models import CommunityPost
        recent_posts = (await db.execute(
            select(CommunityPost.title).where(
                CommunityPost.tenant_id.in_(all_tids),
                func.date(CommunityPost.collected_at) >= date.today() - timedelta(days=14),
            ).order_by(CommunityPost.collected_at.desc()).limit(10)
        )).scalars().all()
        community_issues = [t for t in recent_posts if t]
    except Exception:
        pass  # 커뮤니티 테이블 없어도 계속 진행

    # 팩트시트 구성
    factsheet = _build_debate_factsheet(
        our, opponent, opponent_neg_news, our_pos_news, latest_survey, topics, election,
        community_issues=community_issues,
    )

    style_prompt = {
        "aggressive": "공격적인 어조로, 상대 약점을 강하게 지적하면서도 선거법(비방 금지)을 위반하지 않도록",
        "defensive": "방어적인 어조로, 우리 후보의 강점과 실적을 중심으로 차분하게",
        "balanced": "균형 잡힌 어조로, 상대 약점 지적과 우리 강점 어필을 적절히 배합하여",
    }.get(style, "균형 잡힌 어조로")

    format_prompt = {
        "broadcast": f"방송 토론회 형식. 발언 시간 {speech_minutes}분(약 {speech_minutes * 300}자). 간결하고 임팩트 있게.",
        "speech": f"합동 연설회 형식. 연설 시간 {speech_minutes}분(약 {speech_minutes * 300}자). 청중을 설득하는 웅변 톤.",
        "interview": f"언론 인터뷰 형식. 답변 시간 {speech_minutes}분(약 {speech_minutes * 300}자). 기자 질문에 답하는 톤.",
    }.get(debate_format, f"발언 시간 {speech_minutes}분")

    char_limit = speech_minutes * 300

    # 선거 유형별 핵심 규칙
    etype = election.election_type or ""
    election_rules = ""
    if etype == "superintendent":
        election_rules = (
            "\n\n[교육감 선거 핵심 규칙 — 반드시 준수]\n"
            "1. 교육감은 법적으로 정당 표방이 금지됨. '무소속'이 아니라 '비정당' 선거임.\n"
            "2. '어느 당 소속이냐', '정당 없이 뭘 할 수 있냐'는 공격에 대한 반박:\n"
            "   → '교육감은 정치가 아닌 교육 전문성으로 선출하는 자리' + '오히려 정당색을 드러내는 후보가 선거법 위반 소지'\n"
            "3. 상대가 정당색을 과도하게 드러내면 역공 포인트: '교육의 정치화를 우려하는 학부모/교사 민심을 대변'\n"
            "4. 절대 우리 후보의 정당/진영을 언급하지 말 것. '진보 교육감', '보수 교육감' 같은 표현 금지.\n"
            "5. 교육 현장 경험, 전문성, 정책 구체성으로 승부해야 함.\n"
        )
    elif etype == "governor":
        election_rules = (
            "\n\n[도지사 선거 특성]\n"
            "1. 광역단체장으로 정당 공천 선거. 정당 정책과 후보 역량 모두 중요.\n"
            "2. 지역 현안(SOC, 산업, 인구)과 국정 과제 연계가 핵심.\n"
        )
    elif etype == "mayor":
        election_rules = (
            "\n\n[시장 선거 특성]\n"
            "1. 기초단체장으로 생활밀착형 정책이 핵심.\n"
            "2. 도시 개발, 교통, 복지, 일자리 등 구체적 실행 계획 중심.\n"
        )

    prompt = (
        f"{factsheet}"
        f"{election_rules}\n\n"
        f"위 데이터와 규칙을 바탕으로 {our.name} 후보가 {opponent.name} 후보와의 토론/면접에서 사용할 대본을 작성하세요.\n"
        f"형식: {format_prompt}\n"
        f"스타일: {style_prompt}\n\n"
        f"반드시 아래 JSON 형식으로만 답변하세요:\n"
        f'{{\n'
        f'  "opening": "오프닝 발언 ({min(speech_minutes, 2)}분, {min(char_limit // 3, 600)}자 이내)",\n'
        f'  "key_points": [\n'
        f'    {{"topic": "주제1", "our_position": "우리 입장", "data_point": "근거 데이터", "attack_question": "상대에게 할 질문"}},\n'
        f'    ...\n'
        f'  ],\n'
        f'  "rebuttals": [\n'
        f'    {{"opponent_claim": "상대가 할 수 있는 주장", "our_response": "반박 대본"}},\n'
        f'    ...\n'
        f'  ],\n'
        f'  "closing": "마무리 발언 (1분, 300자 이내)"\n'
        f'}}\n\n'
        f"규칙:\n"
        f"- 전체 대본 합산 {char_limit}자 이내 (발언 {speech_minutes}분 기준)\n"
        f"- key_points: 주제별 공략 포인트 (최대 5개)\n"
        f"- rebuttals: 상대 예상 공격에 대한 반박 (최대 3개)\n"
        f"- 한국어로, 구체적이고 실전 토론에서 바로 사용 가능하게\n"
        f"- 선거법 위반 소지가 있는 비방/허위사실은 절대 포함하지 않기\n"
        f"- 데이터에 근거한 팩트만 사용\n"
        f"- 수집된 뉴스/커뮤니티 반응을 인용하여 구체적 근거 제시"
    )

    # 캠프 메모리 (이전 보고서/콘텐츠 참조)
    from app.services.camp_context import build_camp_memory
    camp_memory = await build_camp_memory(db, tenant_id, str(election_id), max_reports=3, max_briefings=4, max_content=3)
    if camp_memory:
        prompt += f"\n{camp_memory}"

    result = await call_claude(prompt, timeout=600, context="debate_script", tenant_id=tenant_id, db=db)

    if result:
        # 선거법 검증
        full_text = result.get("opening", "") + " " + result.get("closing", "")
        for kp in result.get("key_points", []):
            full_text += " " + kp.get("attack_question", "") + " " + kp.get("our_position", "")
        compliance = _compliance.check_content(full_text, election_date=election.election_date.isoformat() if election.election_date else None)

        ai_result = {
            "opening": result.get("opening", ""),
            "key_points": result.get("key_points", [])[:5],
            "rebuttals": result.get("rebuttals", [])[:3],
            "closing": result.get("closing", ""),
            "compliance": compliance,
            "our_candidate": our.name,
            "opponent": opponent.name,
            "topics": topics,
            "style": style,
            "ai_generated": True,
        }
        await set_cache(db, tenant_id, election_id, cache_key, ai_result)

        # ── 생성 결과 Report 테이블에 저장 (히스토리·챗 컨텍스트 활용) ──
        try:
            from app.elections.models import Report
            import json as _json
            body_text = (
                f"[토론 대본 — {our.name} vs {opponent.name}]\n\n"
                f"[오프닝]\n{ai_result['opening']}\n\n"
                f"[핵심 포인트]\n"
                + "\n".join(
                    f"- {kp.get('topic', '')}: {kp.get('attack_question', '')}"
                    for kp in ai_result["key_points"]
                )
                + f"\n\n[반박]\n"
                + "\n".join(
                    f"- 상대: {r.get('opponent_claim', '')}\n  응답: {r.get('our_response', '')}"
                    for r in ai_result["rebuttals"]
                )
                + f"\n\n[클로징]\n{ai_result['closing']}"
            )
            report = Report(
                tenant_id=tenant_id,
                election_id=election_id,
                report_type="debate_script",
                title=f"[토론 대본] {our.name} vs {opponent.name} — {', '.join(topics[:2])}",
                content_text=body_text,
                report_date=date.today(),
            )
            db.add(report)
            await db.commit()
        except Exception as save_err:
            logger.warning("debate_save_failed", error=str(save_err)[:200])

        return ai_result

    # Fallback: 규칙 기반 핵심 포인트
    fallback = _generate_fallback_script(our, opponent, opponent_neg_news, topics, election)
    await set_cache(db, tenant_id, election_id, cache_key, fallback)
    return fallback


def _build_debate_factsheet(our, opponent, opp_neg_news, our_pos_news, survey, topics, election,
                            community_issues=None) -> str:
    """토론 대본용 팩트시트 구성."""
    d_day = (election.election_date - date.today()).days
    etype = election.election_type or ""

    # 교육감은 정당 표기 금지
    if etype == "superintendent":
        our_label = f"{our.name} (비정당 — 교육감은 정당 표방 금지)"
        opp_label = f"{opponent.name}"
        if opponent.party:
            opp_label += f" (배경: {opponent.party} 계열로 알려짐 — 역공 포인트 가능)"
    else:
        our_label = f"{our.name} ({our.party or '무소속'})"
        opp_label = f"{opponent.name} ({opponent.party or '무소속'})"

    lines = [
        f"[토론 준비 팩트시트]",
        f"선거: {election.name} (D-{d_day})",
        f"선거 유형: {etype}",
        f"우리 후보: {our_label}",
        f"상대 후보: {opp_label}",
        f"토론 주제: {', '.join(topics)}",
        "",
    ]

    if opp_neg_news:
        lines.append(f"[{opponent.name} 약점/공격 포인트 {len(opp_neg_news)}건]")
        for n in opp_neg_news[:7]:
            sq = f" [{n.strategic_quadrant}]" if n.strategic_quadrant else ""
            lines.append(f"-{sq} {n.title[:70]}")
            if n.ai_summary:
                lines.append(f"  요약: {n.ai_summary[:150]}")
            if n.ai_reason:
                lines.append(f"  근거: {n.ai_reason[:120]}")
            if n.action_summary:
                lines.append(f"  공격 방향: {n.action_summary[:120]}")
        lines.append("")

    if our_pos_news:
        lines.append(f"[{our.name} 강점 근거 {len(our_pos_news)}건]")
        for n in our_pos_news[:5]:
            sq = f" [{n.strategic_quadrant}]" if n.strategic_quadrant else ""
            lines.append(f"-{sq} {n.title[:70]}")
            if n.ai_summary:
                lines.append(f"  요약: {n.ai_summary[:150]}")
            if n.action_summary:
                lines.append(f"  어필: {n.action_summary[:120]}")
        lines.append("")

    if survey and survey.results:
        lines.append(f"[최근 여론조사: {survey.survey_org} ({survey.survey_date})]")
        for name, rate in (survey.results or {}).items():
            if isinstance(rate, (int, float)):
                lines.append(f"  {name}: {rate}%")
        lines.append("")

    if community_issues:
        lines.append(f"[최근 커뮤니티/여론 이슈]")
        for issue in community_issues[:5]:
            lines.append(f"- {issue}")
        lines.append("")

    return "\n".join(lines)


def _generate_fallback_script(our, opponent, opp_neg_news, topics, election) -> dict:
    """AI 불가 시 규칙 기반 토론 스크립트."""
    d_day = (election.election_date - date.today()).days

    key_points = []
    for topic in topics[:3]:
        point = {
            "topic": topic,
            "our_position": f"{our.name} 후보의 {topic} 관련 핵심 공약을 준비하세요",
            "data_point": "구체적 데이터를 대시보드에서 확인하세요",
            "attack_question": f"{opponent.name} 후보의 {topic} 관련 구체적 계획이 있는지 질문",
        }
        key_points.append(point)

    # 부정 뉴스 기반 공략 포인트 추가
    for n in opp_neg_news[:2]:
        key_points.append({
            "topic": "언론 보도 관련",
            "our_position": "투명한 행정과 소통을 강조",
            "data_point": f"보도: {n.title[:50]}",
            "attack_question": f"'{n.title[:30]}' 보도에 대한 입장을 물어보세요",
        })

    compliance = _compliance.check_content(
        " ".join(kp["attack_question"] for kp in key_points),
        election_date=election.election_date.isoformat() if election.election_date else None,
    )

    return {
        "opening": f"안녕하십니까. {election.name}에 출마한 {our.name}입니다. D-{d_day}, 지역의 미래를 위해 준비한 비전을 말씀드리겠습니다.",
        "key_points": key_points[:5],
        "rebuttals": [
            {"opponent_claim": "경험 부족 지적", "our_response": "새로운 시각과 구체적 데이터로 준비했습니다"},
            {"opponent_claim": "실현 불가능 공약", "our_response": "예산 근거와 실행 계획이 마련되어 있습니다"},
        ],
        "closing": f"주민 여러분, {our.name}은 데이터와 소통으로 함께하겠습니다. 감사합니다.",
        "compliance": compliance,
        "our_candidate": our.name,
        "opponent": opponent.name,
        "topics": topics,
        "style": "balanced",
        "ai_generated": False,
    }
