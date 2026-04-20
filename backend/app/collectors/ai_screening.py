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
★ 알려진 동명이인: {homonym_str}

아래 {len(items)}개 수집된 콘텐츠를 각각 스크리닝하세요.

★★★ 제1원칙: 동명이인/무관 콘텐츠 자동 감지 및 차단 ★★★

**당신이 문맥으로 직접 판단하세요. 위 힌트에 없어도 아래를 적용:**

다음 경우는 is_relevant: false + homonym_detected에 정체 기록:
- 같은 이름이지만 직업/배경이 다른 사람 (예: 야구감독, 가수, 배우, 교수, 국회의원, 기업인, 군인, 의사, 운동선수 등)
- 다른 지역/다른 선거 출마자 (우리는 {region_clause}{election_type}, 다른 지역/유형이면 false)
- 과거 인물 / 역사 속 인물 / 드라마·영화 속 인물
- 후보 이름이 제목/내용에 전혀 언급되지 않은 글

동명이인 감지 시 `homonym_detected` 필드에 **간결한 키워드**로 정체를 기록:
- "야구감독", "프로야구 한화", "국회의원 서천", "대학교수", "배우" 같은 2~4 단어

★★ 자동 차단 유형(block_type) 분류 — 동명이인일 때만 ★★
콘텐츠가 **동명이인 판정(is_relevant=false)** 인 경우, 향후 차단 방법을 지정하세요:

- "channel_block": **YouTube 채널명에 후보 이름이 포함된 개인 채널** (예: "윤건영TV", "김철수 일상")
  → 이 채널은 해당 동명이인이 운영하며, 본 후보가 출연할 확률 사실상 0. 채널 통째로 차단.
- "source_video": **언론사·공용 YouTube 채널의 개별 영상** (채널명에 이름 없음)
  → 채널은 본 후보 영상도 올릴 수 있으니 해당 영상 1건만 차단.
- "source_url": **언론사/커뮤니티의 개별 기사/글 URL**
  → URL 1건만 차단, 언론사 전체는 유지.
- "none": 동명이인 아니거나(is_relevant=true) 차단 불필요

판정 원칙:
1. 채널/언론사명 만 보고 판정 금지. 제목·내용에 후보 이름과 {region_clause}{election_type} 맥락이 함께 등장해야 본인.
2. 애매하면 is_relevant=true 유지 (과도한 차단 방지).

★★ 판단 기준 ★★
1. is_relevant: 이 글이 {region_clause}{election_type} 선거의 우리 후보/경쟁후보와 관련된 글인가?
2. homonym_detected: 같은 이름의 다른 사람이면 정체 (없으면 null)
3. block_type: "channel_block" | "source_video" | "source_url" | "none"
4. sentiment: positive / negative / neutral
5. strategic_value: strength / weakness / opportunity / threat / neutral
6. summary: 핵심 1문장 요약
7. threat_level: none / low / medium / high

콘텐츠:
{items_block}

반드시 아래 JSON array 형식으로만 답변하세요.
[
  {{
    "id": "...",
    "is_relevant": true,
    "homonym_detected": null,
    "block_type": "none",
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

        block_type = r.get("block_type") or "none"
        if block_type not in ("channel_block", "source_video", "source_url", "none"):
            block_type = "none"

        result_map[rid] = {
            "is_relevant": is_rel,
            "homonym_detected": r.get("homonym_detected") or None,
            "block_type": block_type,
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

    # 동명이인 자동 학습 — 감지된 homonym을 candidate 테이블에 누적
    if db and tenant_id:
        try:
            homonyms_by_candidate = {}
            for r in results:
                hd = r.get("homonym_detected")
                if hd and str(hd).strip() and str(hd).lower() != "null":
                    # 해당 id의 item에서 candidate_name 조회
                    rid = str(r.get("id", ""))
                    for it in items:
                        if str(it["id"]) == rid and it.get("candidate_name"):
                            cname = it["candidate_name"]
                            homonyms_by_candidate.setdefault(cname, set()).add(str(hd).strip()[:40])
                            break

            for cname, detected in homonyms_by_candidate.items():
                from sqlalchemy import text as sql_text
                # 기존 homonym_filters 가져와서 병합
                row = (await db.execute(sql_text(
                    "SELECT id, COALESCE(homonym_filters, '[]'::jsonb) as hf "
                    "FROM candidates WHERE tenant_id = :tid AND name = :cn LIMIT 1"
                ), {"tid": tenant_id, "cn": cname})).fetchone()
                if row:
                    existing = set(row.hf) if row.hf else set()
                    merged = list(existing | detected)[:20]  # 최대 20개
                    if len(merged) > len(existing):
                        import json as _json
                        await db.execute(sql_text(
                            "UPDATE candidates SET homonym_filters = :hf::jsonb WHERE id = :cid"
                        ), {"hf": _json.dumps(merged, ensure_ascii=False), "cid": str(row.id)})
                        await db.commit()
                        logger.info("homonym_auto_learned", candidate=cname,
                                    added=list(detected - existing))
        except Exception as e:
            logger.warning("homonym_learn_error", error=str(e)[:200])

    # 결과 병합
    for it in items:
        iid = str(it["id"])
        if iid in result_map:
            it.update(result_map[iid])
        else:
            # AI가 응답하지 않은 항목은 통과시킴
            it["is_relevant"] = True
            it["ai_screened"] = False

    # ★ 동명이인 자동 차단 리스트 (excluded_identifiers) 업데이트 ★
    # block_type 별로 channel_name / video_id / news_url / community_url 자동 등록
    if db and items:
        try:
            # items 에서 election_id 추출 (모든 items 가 같은 election 이어야 함)
            from app.collectors.exclusion_service import apply_ai_exclusions
            eid = None
            for it in items:
                if it.get("election_id"):
                    eid = it["election_id"]
                    break
            if eid:
                await apply_ai_exclusions(db, election_id=str(eid), tenant_id=tenant_id, items=items)
                await db.commit()
        except Exception as e:
            logger.warning("apply_exclusions_error", error=str(e)[:200])

    return items
