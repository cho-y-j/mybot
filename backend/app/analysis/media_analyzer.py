"""
ElectionPulse - AI 미디어 콘텐츠 전략 분석
모든 콘텐츠를 4사분면(우리 vs 경쟁자 × 긍정 vs 부정)으로 자동 분류.
Batch 모드: 한 번 호출에 5~10건 처리 → 비용/시간 5배 효율.
"""
import asyncio
import json
import shutil
from typing import Optional
import structlog

logger = structlog.get_logger()


async def analyze_batch_strategic(
    items: list[dict],
    our_candidate_name: str,
    rival_candidate_names: list[str],
    election_type: str = "시장",
    region: str = "",
) -> list[dict]:
    """
    여러 콘텐츠를 한 번의 Claude 호출로 전략 분석.

    items: [{"id": "...", "title": "...", "description": "..."}]
    Returns: [{"id": "...", "is_relevant": bool, "is_about_our_candidate": bool,
               "sentiment": "...", "strategic_value": "...", "action_type": "...",
               "action_priority": "...", "action_summary": "...",
               "summary": "...", "topics": [...], "threat_level": "..."}]
    """
    claude_path = shutil.which("claude")
    if not claude_path or not items:
        return []

    region_clause = f"{region} " if region else ""
    rivals_str = ", ".join(rival_candidate_names) if rival_candidate_names else "(경쟁 후보 미등록)"

    items_block = "\n\n".join([
        f"[{i}] id={it['id']}\n제목: {it.get('title','')}\n내용: {(it.get('description','') or '')[:500]}"
        for i, it in enumerate(items)
    ])

    prompt = f"""당신은 {region_clause}{election_type} 선거 캠프의 전략 분석관입니다.

★ 우리 후보: {our_candidate_name} ({region_clause}{election_type} 후보)
★ 경쟁 후보: {rivals_str}

아래 {len(items)}개 콘텐츠를 각각 분석하여 4사분면 전략 분류하세요.

★★★ 가장 중요: 사건(event) vs 행동(action) 구분 ★★★
한 콘텐츠 안에 부정 키워드가 있어도 발화 주체와 행위에 따라 정반대로 분류한다.

▶ 우리 후보 본인이 발표/해명/주장/공개/제안/약속/항의/요구/입장표명한 콘텐츠
   = strength (능동 메시지) — 사건이 부정적이어도 우리 후보의 행동은 강점이다
   예) "{our_candidate_name}, 컷오프 부당성 긴급 입장 발표" → strength (능동 항의 메시지로 어필)
   예) "{our_candidate_name}, 재경선 수용 발표" → strength (대승적 결단 어필)
   예) "{our_candidate_name} 공약 발표" → strength
   예) "{our_candidate_name}, 시민 200명 면담" → strength

▶ 우리 후보가 외부에 의해 비판당하거나 사고/논란/실수/의혹/스캔들로 보도된 콘텐츠
   = weakness (실제 위기) — 즉시 방어 필요
   예) "{our_candidate_name} 부동산 투기 의혹" → weakness
   예) "{our_candidate_name} 발언으로 시민단체 반발" → weakness
   예) "{our_candidate_name} 컷오프 — 자격 미달 지적" → weakness

▶ 경쟁 후보가 비판당하거나 사고/논란/약점이 노출된 콘텐츠
   = opportunity (공격 기회) — 우리에겐 호재
   예) "{(rival_candidate_names[0] if rival_candidate_names else '경쟁자')}, 공천 잡음" → opportunity
   예) "{(rival_candidate_names[0] if rival_candidate_names else '경쟁자')} 컷오프 번복 논란" → opportunity

▶ 경쟁 후보가 능동적으로 발표/성과/지지층 결집한 콘텐츠
   = threat (경쟁 위협) — 견제 필요
   예) "{(rival_candidate_names[0] if rival_candidate_names else '경쟁자')}, 청주예술제 45만 동원 성공" → threat

▶ 단순 정보/제3자/지역 일반 뉴스 = neutral

★★ 분류 필드 ★★
1. is_relevant: 동명이인/무관 콘텐츠 검증 (산은캐피탈 사외이사, 야구선수, 군 병장, 다른 지역 정치인 등은 false)
2. is_about_our_candidate: 우리 후보 본인/우리 캠프 관련이면 true. 경쟁 후보 단독 관련이면 false.
3. sentiment: 콘텐츠의 객관적 톤 (positive/negative/neutral)
4. strategic_value: 위 사건/행동 구분 룰에 따라 strength/weakness/opportunity/threat/neutral
5. action_type:
   - strength → promote (확산)
   - weakness → defend (방어/해명)
   - opportunity → attack (공격/활용)
   - threat → monitor (견제)
   - neutral → ignore
6. action_priority: high (즉시 대응) | medium (오늘 안에) | low (참고)
7. action_summary: "어떻게 활용/대응할지" 한 줄 (40자 이내)

콘텐츠:
{items_block}

반드시 아래 JSON array 형식으로만 답변하세요. id 순서 유지.
[
  {{
    "id": "...",
    "is_relevant": true,
    "is_about_our_candidate": true,
    "sentiment": "positive",
    "strategic_value": "strength",
    "action_type": "promote",
    "action_priority": "medium",
    "action_summary": "지역 매체로 확산, 카드뉴스 제작",
    "summary": "콘텐츠 핵심 1문장",
    "reason": "왜 이 분류인지 한 줄",
    "topics": ["주제1", "주제2"],
    "threat_level": "none"
  }},
  ...
]
JSON array만 출력하세요. 다른 텍스트 절대 금지."""

    try:
        proc = await asyncio.create_subprocess_exec(
            claude_path, "-p", prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
        if proc.returncode != 0 or not stdout:
            logger.warning("ai_batch_no_output", count=len(items))
            return []

        text = stdout.decode("utf-8").strip()
        # JSON array 추출
        start = text.find("[")
        end = text.rfind("]") + 1
        if start < 0 or end <= start:
            logger.warning("ai_batch_no_json", text=text[:200])
            return []

        results = json.loads(text[start:end])
        if not isinstance(results, list):
            return []

        # 정규화
        for r in results:
            r["is_relevant"] = bool(r.get("is_relevant", True))
            r["is_about_our_candidate"] = bool(r.get("is_about_our_candidate", False))
            r["sentiment"] = r.get("sentiment", "neutral").lower()
            if r["sentiment"] not in ("positive", "negative", "neutral"):
                r["sentiment"] = "neutral"
            r["strategic_value"] = r.get("strategic_value", "neutral").lower()
            if r["strategic_value"] not in ("strength", "weakness", "opportunity", "threat", "neutral"):
                r["strategic_value"] = "neutral"
            r["action_type"] = r.get("action_type", "monitor").lower()
            if r["action_type"] not in ("defend", "attack", "promote", "monitor", "ignore"):
                r["action_type"] = "monitor"
            r["action_priority"] = r.get("action_priority", "low").lower()
            if r["action_priority"] not in ("high", "medium", "low"):
                r["action_priority"] = "low"
            r["threat_level"] = r.get("threat_level", "none").lower()
            if r["threat_level"] not in ("none", "low", "medium", "high"):
                r["threat_level"] = "none"
            try:
                r["sentiment_score"] = float(r.get("sentiment_score", 0))
            except (TypeError, ValueError):
                r["sentiment_score"] = 0.0
            if not isinstance(r.get("topics"), list):
                r["topics"] = []
            # 무관 콘텐츠 강제 중립화
            if not r["is_relevant"]:
                r["sentiment"] = "neutral"
                r["sentiment_score"] = 0.0
                r["threat_level"] = "none"
                r["strategic_value"] = "neutral"
                r["action_type"] = "ignore"

        logger.info("ai_batch_done", input=len(items), output=len(results))
        return results

    except asyncio.TimeoutError:
        logger.warning("ai_batch_timeout", count=len(items))
        return []
    except Exception as e:
        logger.warning("ai_batch_error", error=str(e), count=len(items))
        return []


async def analyze_content_with_ai(
    title: str,
    description: str,
    candidate_name: str,
    content_type: str = "news",  # news | youtube | community
    election_type: str = "시장",
    region: str = "",
) -> Optional[dict]:
    """
    콘텐츠를 Claude로 분석하여 구조화된 인사이트 반환.

    Returns: {
        "is_relevant": true/false,           # ★ 후보 본인과 관련 있는지 (동명이인 검증)
        "summary": "1-2문장 요약",
        "reason": "왜 긍정/부정인지 한 문장 이유",
        "topics": ["급식", "교권", ...],
        "threat_level": "none|low|medium|high",
        "sentiment": "positive|negative|neutral",
        "sentiment_score": -1.0 ~ 1.0,
    }
    """
    claude_path = shutil.which("claude")
    if not claude_path:
        return None

    type_label = {"news": "뉴스 기사", "youtube": "유튜브 영상", "community": "커뮤니티 게시글"}.get(content_type, "콘텐츠")
    region_clause = f"{region} " if region else ""

    prompt = f"""당신은 {region_clause}{election_type} 선거 캠프의 미디어 분석 전문가입니다.
분석 대상 후보: {candidate_name} ({region_clause}{election_type} 후보)

다음 {type_label}을 분석하세요:
제목: {title}
내용: {description[:800]}

★★ 가장 중요한 첫 번째 판단: 동명이인 검증 ★★
이 콘텐츠의 "{candidate_name}" 이 정말 {region_clause}{election_type} 후보 본인인가?
- 산은캐피탈 사외이사, 야구선수, 군 병장, 기업체 임원, 교수, 배우 등 다른 인물이면 false
- 다른 지역의 정치인, 다른 직책의 동명이인이면 false
- 우리 후보 본인 또는 우리 후보 캠프/선거 관련 기사이면 true

반드시 아래 JSON 형식으로만 답변하세요 (다른 텍스트 절대 금지):
{{
  "is_relevant": true,
  "relevance_reason": "왜 본인/타인 판단했는지 한 줄",
  "summary": "핵심 내용 1-2문장 요약",
  "reason": "{candidate_name}에게 왜 긍정/부정/중립인지 한 문장 이유",
  "topics": ["주제1", "주제2"],
  "threat_level": "none|low|medium|high",
  "sentiment": "positive|negative|neutral",
  "sentiment_score": 0.5
}}

분석 기준:
- is_relevant: 가장 중요. 동명이인이면 false 처리하고 sentiment=neutral, threat_level=none
- summary: 객관적 요약 (50자 이내)
- reason: 후보 관점에서 의미 (짧고 명확하게)
- topics: 다루는 정책/이슈 키워드 (1~3개)
- threat_level: 위협도 (none/low/medium/high)
- sentiment: 전반적 톤
- sentiment_score: -1.0 (매우 부정) ~ 1.0 (매우 긍정)

JSON만 출력하세요."""

    try:
        proc = await asyncio.create_subprocess_exec(
            claude_path, "-p", prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=45)

        if proc.returncode != 0 or not stdout:
            return None

        text = stdout.decode("utf-8").strip()

        # JSON 부분 추출
        start = text.find("{")
        end = text.rfind("}") + 1
        if start < 0 or end <= start:
            return None

        result = json.loads(text[start:end])

        # 필수 필드 검증
        if not result.get("summary"):
            return None

        # 정규화
        result["threat_level"] = result.get("threat_level", "none").lower()
        if result["threat_level"] not in ["none", "low", "medium", "high"]:
            result["threat_level"] = "none"

        result["sentiment"] = result.get("sentiment", "neutral").lower()
        if result["sentiment"] not in ["positive", "negative", "neutral"]:
            result["sentiment"] = "neutral"

        try:
            result["sentiment_score"] = float(result.get("sentiment_score", 0))
        except:
            result["sentiment_score"] = 0.0

        if not isinstance(result.get("topics"), list):
            result["topics"] = []

        # is_relevant 정규화 (default true — AI가 명시하지 않으면 통과)
        result["is_relevant"] = bool(result.get("is_relevant", True))
        result["relevance_reason"] = str(result.get("relevance_reason", ""))[:200]

        # 무관 콘텐츠는 강제 중립 처리 (오염된 통계 방지)
        if not result["is_relevant"]:
            result["sentiment"] = "neutral"
            result["sentiment_score"] = 0.0
            result["threat_level"] = "none"

        return result

    except asyncio.TimeoutError:
        logger.warning("ai_analysis_timeout", title=title[:50])
        return None
    except Exception as e:
        logger.warning("ai_analysis_error", error=str(e), title=title[:50])
        return None


async def _get_election_context(db_session, election_id: str) -> dict:
    """선거의 election_type, 지역, 우리/경쟁 후보 명단 반환 (전략 분석용)."""
    from sqlalchemy import text as sql_text
    from app.elections.korea_data import ELECTION_ISSUES, REGIONS

    row = (await db_session.execute(sql_text("""
        SELECT election_type, region_sido, region_sigungu FROM elections WHERE id = :eid
    """), {"eid": election_id})).first()
    if not row:
        return {"type_label": "후보", "region": "", "our_name": "", "rival_names": []}
    etype, sido, sigungu = row
    raw_label = ELECTION_ISSUES.get(etype, {}).get("label", "후보")
    type_label = raw_label.split("(")[0].strip().split(" ")[0]
    region_short = REGIONS.get(sido, {}).get("short", "") if sido else ""
    region = f"{region_short} {sigungu}".strip() or sido or ""

    # 후보 명단
    cand_rows = (await db_session.execute(sql_text("""
        SELECT name, is_our_candidate FROM candidates
        WHERE election_id = :eid AND enabled = TRUE
    """), {"eid": election_id})).all()
    our_name = next((r[0] for r in cand_rows if r[1]), "")
    rival_names = [r[0] for r in cand_rows if not r[1]]

    return {
        "type_label": type_label,
        "region": region,
        "our_name": our_name,
        "rival_names": rival_names,
    }


async def _analyze_table_strategic(
    db_session, tenant_id: str, election_id: str,
    table: str, content_col: str, limit: int = 30, batch_size: int = 8,
) -> dict:
    """공통 batch 전략 분석 — news/community/youtube에 재사용."""
    from sqlalchemy import text as sql_text

    ctx = await _get_election_context(db_session, election_id)
    if not ctx["our_name"]:
        return {"analyzed": 0, "irrelevant": 0, "by_quadrant": {}, "error": "no_our_candidate"}

    rows = (await db_session.execute(sql_text(f"""
        SELECT t.id, t.title, t.{content_col}, c.name
        FROM {table} t
        JOIN candidates c ON t.candidate_id = c.id
        WHERE t.tenant_id = :tid AND t.election_id = :eid
          AND t.ai_analyzed_at IS NULL
        ORDER BY t.collected_at DESC
        LIMIT :lim
    """), {"tid": tenant_id, "eid": election_id, "lim": limit})).all()

    if not rows:
        return {"analyzed": 0, "irrelevant": 0, "by_quadrant": {}}

    items = [
        {"id": str(r[0]), "title": r[1] or "", "description": r[2] or "", "candidate": r[3]}
        for r in rows
    ]

    analyzed = 0
    irrelevant = 0
    by_quadrant = {"strength": 0, "weakness": 0, "opportunity": 0, "threat": 0, "neutral": 0}

    # batch 단위로 호출
    for i in range(0, len(items), batch_size):
        batch = items[i:i + batch_size]
        results = await analyze_batch_strategic(
            items=batch,
            our_candidate_name=ctx["our_name"],
            rival_candidate_names=ctx["rival_names"],
            election_type=ctx["type_label"],
            region=ctx["region"],
        )
        # id로 매핑
        result_by_id = {r.get("id"): r for r in results if r.get("id")}

        for item in batch:
            r = result_by_id.get(item["id"])
            if not r:
                continue
            is_rel = r["is_relevant"]
            ai_summary = r.get("summary", "")
            if not is_rel:
                ai_summary = f"[동명이인/무관] {ai_summary}"
                irrelevant += 1
            by_quadrant[r["strategic_value"]] = by_quadrant.get(r["strategic_value"], 0) + 1

            await db_session.execute(sql_text(f"""
                UPDATE {table} SET
                    ai_summary = :summary,
                    ai_reason = :reason,
                    ai_topics = :topics,
                    ai_threat_level = :threat,
                    sentiment = :sentiment,
                    sentiment_score = :score,
                    strategic_value = :sval,
                    action_type = :atype,
                    action_priority = :apri,
                    action_summary = :asum,
                    is_about_our_candidate = :is_ours,
                    ai_analyzed_at = NOW(),
                    candidate_id = CASE WHEN :is_rel THEN candidate_id ELSE NULL END
                WHERE id = :id
            """), {
                "id": item["id"],
                "summary": ai_summary,
                "reason": r.get("reason", ""),
                "topics": json.dumps(r.get("topics", []), ensure_ascii=False),
                "threat": r["threat_level"],
                "sentiment": r["sentiment"],
                "score": r["sentiment_score"],
                "sval": r["strategic_value"],
                "atype": r["action_type"],
                "apri": r["action_priority"],
                "asum": (r.get("action_summary") or "")[:300],
                "is_ours": r["is_about_our_candidate"],
                "is_rel": is_rel,
            })
            analyzed += 1

    await db_session.commit()
    return {"analyzed": analyzed, "irrelevant": irrelevant, "by_quadrant": by_quadrant}



async def analyze_unanalyzed_news(db_session, tenant_id: str, election_id: str, limit: int = 30) -> dict:
    """뉴스 batch 전략 분석 (4사분면 분류 포함)."""
    return await _analyze_table_strategic(
        db_session, tenant_id, election_id,
        table="news_articles", content_col="summary", limit=limit, batch_size=8,
    )


async def analyze_unanalyzed_youtube(db_session, tenant_id: str, election_id: str, limit: int = 30) -> dict:
    """유튜브 batch 전략 분석."""
    return await _analyze_table_strategic(
        db_session, tenant_id, election_id,
        table="youtube_videos", content_col="description_snippet", limit=limit, batch_size=8,
    )


async def analyze_unanalyzed_community(db_session, tenant_id: str, election_id: str, limit: int = 30) -> dict:
    """커뮤니티 batch 전략 분석."""
    return await _analyze_table_strategic(
        db_session, tenant_id, election_id,
        table="community_posts", content_col="content_snippet", limit=limit, batch_size=8,
    )


async def analyze_all_media(db_session, tenant_id: str, election_id: str, limit_per_type: int = 30) -> dict:
    """뉴스 + 유튜브 + 커뮤니티 모두 batch 전략 분석.

    Returns:
        총 사분면 통계 + 각 매체별 결과
    """
    news_result = await analyze_unanalyzed_news(db_session, tenant_id, election_id, limit_per_type)
    yt_result = await analyze_unanalyzed_youtube(db_session, tenant_id, election_id, limit_per_type)
    cm_result = await analyze_unanalyzed_community(db_session, tenant_id, election_id, limit_per_type)

    total_q = {"strength": 0, "weakness": 0, "opportunity": 0, "threat": 0, "neutral": 0}
    for r in (news_result, yt_result, cm_result):
        for k, v in (r.get("by_quadrant") or {}).items():
            total_q[k] = total_q.get(k, 0) + v

    return {
        "news": news_result,
        "youtube": yt_result,
        "community": cm_result,
        "total_analyzed": (
            news_result.get("analyzed", 0)
            + yt_result.get("analyzed", 0)
            + cm_result.get("analyzed", 0)
        ),
        "total_irrelevant": (
            news_result.get("irrelevant", 0)
            + yt_result.get("irrelevant", 0)
            + cm_result.get("irrelevant", 0)
        ),
        "by_quadrant": total_q,
    }
