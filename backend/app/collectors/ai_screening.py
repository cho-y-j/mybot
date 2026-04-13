"""
수집 단계 AI 스크리닝 — 수집된 raw 데이터를 DB 저장 전에 AI로 필터링.

흐름: 수집(raw) → AI 스크리닝 → 통과한 것만 DB 저장
- 동명이인 구분
- 관련성 판별
- 감성/전략 분류
- 게시일 추출
- 1줄 요약
"""
import structlog
from app.services.ai_service import call_claude

logger = structlog.get_logger()


async def screen_collected_items(
    items: list[dict],
    our_candidate_name: str,
    rival_candidate_names: list[str],
    election_type: str = "시장",
    region: str = "",
    homonym_hints: list[str] | None = None,
    tenant_id: str | None = None,
    db=None,
) -> list[dict]:
    """
    수집된 raw 데이터를 AI로 스크리닝.

    items: [{"id": str, "title": str, "description": str, "url": str, "candidate_name": str}]
    homonym_hints: 후보의 동명이인 힌트 (예: ["야구감독", "배우"])

    Returns: 원본 items에 AI 결과가 추가된 리스트 (is_relevant=true인 것만)
    """
    if not items:
        return []

    # 배치 크기 제한 (AI 호출당 최대 10개)
    all_results = []
    for i in range(0, len(items), 10):
        batch = items[i:i + 10]
        batch_results = await _screen_batch(
            batch, our_candidate_name, rival_candidate_names,
            election_type, region, homonym_hints, tenant_id, db,
        )
        all_results.extend(batch_results)

    # is_relevant=true인 것만 반환
    relevant = [r for r in all_results if r.get("is_relevant", False)]
    logger.info(
        "ai_screening_done",
        total=len(items),
        relevant=len(relevant),
        filtered=len(items) - len(relevant),
    )
    return relevant


async def _screen_batch(
    items: list[dict],
    our_candidate_name: str,
    rival_candidate_names: list[str],
    election_type: str,
    region: str,
    homonym_hints: list[str] | None,
    tenant_id: str | None,
    db,
) -> list[dict]:
    """배치 단위 AI 스크리닝."""
    region_clause = f"{region} " if region else ""
    rivals_str = ", ".join(rival_candidate_names) if rival_candidate_names else "(경쟁 후보 미등록)"
    homonym_str = ", ".join(homonym_hints) if homonym_hints else "없음"

    items_block = "\n\n".join([
        f"[{i}] id={it['id']}\n후보: {it.get('candidate_name', '')}\n제목: {it.get('title', '')}\n내용: {(it.get('description', '') or '')[:500]}"
        for i, it in enumerate(items)
    ])

    prompt = f"""당신은 {region_clause}{election_type} 선거 데이터 스크리닝 담당자입니다.

★ 우리 후보: {our_candidate_name} ({region_clause}{election_type} 후보)
★ 경쟁 후보: {rivals_str}
★ 동명이인 주의: {homonym_str} — 이들은 우리 후보가 아닙니다!

아래 {len(items)}개 수집된 콘텐츠를 각각 스크리닝하세요.

★★★ 제1원칙: 동명이인/무관 콘텐츠 차단 ★★★
- 같은 이름이지만 다른 사람(야구감독, 야구선수, 국회의원, 배우, 교수 등)의 글 → is_relevant: false
- {election_type} 선거와 전혀 관련 없는 글 → is_relevant: false
- 후보 이름이 제목/내용에 언급되지 않은 글 → is_relevant: false

★★ 판단 기준 ★★
1. is_relevant: 이 글이 {region_clause}{election_type} 선거와 관련된 글인가?
2. sentiment: positive(긍정) / negative(부정) / neutral(중립)
3. strategic_value: strength(우리 강점) / weakness(우리 약점) / opportunity(기회) / threat(위협) / neutral
4. summary: 핵심 1문장 요약
5. threat_level: none / low / medium / high

콘텐츠:
{items_block}

반드시 아래 JSON array 형식으로만 답변하세요.
[
  {{
    "id": "...",
    "is_relevant": true,
    "sentiment": "positive",
    "sentiment_score": 0.7,
    "strategic_value": "strength",
    "action_type": "promote",
    "action_priority": "medium",
    "action_summary": "활용 방법 한 줄",
    "summary": "핵심 1문장",
    "reason": "판단 이유 한 줄",
    "topics": ["주제1"],
    "threat_level": "none",
    "is_about_our_candidate": true
  }}
]
JSON array만 출력하세요."""

    try:
        ai_result = await call_claude(
            prompt,
            timeout=90,
            context="media_analyze_batch",
            tenant_id=tenant_id,
            db=db,
        )
        if not ai_result or "items" not in ai_result:
            logger.warning("ai_screening_no_output", count=len(items))
            # AI 실패 시 모든 항목을 통과시킴 (기존 동작 유지)
            for it in items:
                it["is_relevant"] = True
                it["ai_screened"] = False
            return items

        results = ai_result["items"]
        if not isinstance(results, list):
            for it in items:
                it["is_relevant"] = True
                it["ai_screened"] = False
            return items

    except Exception as e:
        logger.error("ai_screening_error", error=str(e)[:200])
        # AI 실패 시 모든 항목을 통과시킴
        for it in items:
            it["is_relevant"] = True
            it["ai_screened"] = False
        return items

    # AI 결과를 원본 items에 병합
    result_map = {}
    for r in results:
        rid = str(r.get("id", ""))
        # 유효성 검증
        sentiment = r.get("sentiment", "neutral")
        if sentiment not in ("positive", "negative", "neutral"):
            sentiment = "neutral"
        sval = r.get("strategic_value", "neutral")
        if sval not in ("strength", "weakness", "opportunity", "threat", "neutral"):
            sval = "neutral"

        is_rel = r.get("is_relevant", True)
        if not is_rel:
            sentiment = "neutral"
            sval = "neutral"

        result_map[rid] = {
            "is_relevant": is_rel,
            "sentiment": sentiment,
            "sentiment_score": float(r.get("sentiment_score", 0.0)),
            "strategic_value": sval,
            "strategic_quadrant": sval,
            "action_type": r.get("action_type", "ignore"),
            "action_priority": r.get("action_priority", "low"),
            "action_summary": (r.get("action_summary") or "")[:300],
            "ai_summary": r.get("summary", ""),
            "ai_reason": r.get("reason", ""),
            "ai_topics": r.get("topics", []),
            "threat_level": r.get("threat_level", "none"),
            "is_about_our_candidate": r.get("is_about_our_candidate", False),
            "ai_screened": True,
        }

    # 결과 병합
    for it in items:
        iid = str(it["id"])
        if iid in result_map:
            it.update(result_map[iid])
        else:
            # AI가 응답하지 않은 항목은 통과시킴
            it["is_relevant"] = True
            it["ai_screened"] = False

    return items
