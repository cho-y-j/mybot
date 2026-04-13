"""
ElectionPulse - AI 미디어 콘텐츠 전략 분석
모든 콘텐츠를 4사분면(우리 vs 경쟁자 × 긍정 vs 부정)으로 자동 분류.
Batch 모드: 한 번 호출에 5~10건 처리 → 비용/시간 5배 효율.

AI 호출은 반드시 app.services.ai_service.call_claude() 경유 (고객 API키 → 배정 CLI → 시스템 CLI 자동 전환).
"""
import json
import structlog

logger = structlog.get_logger()


async def analyze_batch_strategic(
    items: list[dict],
    our_candidate_name: str,
    rival_candidate_names: list[str],
    election_type: str = "시장",
    region: str = "",
    tenant_id: str | None = None,
    db = None,
) -> list[dict]:
    """
    여러 콘텐츠를 한 번의 Claude 호출로 전략 분석.

    items: [{"id": "...", "title": "...", "description": "..."}]
    Returns: [{"id": "...", "is_relevant": bool, "is_about_our_candidate": bool,
               "sentiment": "...", "strategic_value": "...", "action_type": "...",
               "action_priority": "...", "action_summary": "...",
               "summary": "...", "topics": [...], "threat_level": "..."}]
    """
    if not items:
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

★★ sentiment 감성 분류 규칙 (절대 준수) ★★
sentiment는 기사의 객관적 톤이다. neutral 남발 금지! 대부분의 선거 기사는 positive 또는 negative다.

- strength (우리 후보 능동 행동) → sentiment = positive (공약발표, 시민면담, 입장표명 등)
- weakness (우리 후보 위기) → sentiment = negative (의혹, 비판, 논란 등)
- opportunity (경쟁자 리스크) → sentiment = negative (비판적 보도 톤)
- threat (경쟁자 위협) → sentiment = positive (성과/동원 긍정 보도 톤)
- neutral (제3자/일반 뉴스) → sentiment = neutral

★ neutral은 정말 팩트만 나열하고 어떤 판단도 없는 기사에만 써라.
★ "~를 발표했다", "~를 약속했다" = positive. "~가 논란이다", "~에 반발" = negative.
★ 의심스러우면 positive 또는 negative 중 하나를 골라라. neutral은 최후의 수단이다.

★★ 분류 필드 ★★
1. is_relevant: 동명이인/무관 콘텐츠 검증 (산은캐피탈 사외이사, 야구선수, 군 병장, 다른 지역 정치인 등은 false)
2. is_about_our_candidate: 우리 후보 본인/우리 캠프 관련이면 true. 경쟁 후보 단독 관련이면 false.
3. sentiment: 위 감성 규칙에 따라 positive/negative/neutral (neutral 남발 금지!)
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

    from app.services.ai_service import call_claude

    try:
        ai_result = await call_claude(
            prompt,
            timeout=120,
            context="media_analyze_batch",
            tenant_id=tenant_id,
            db=db,
        )
        if not ai_result or "items" not in ai_result:
            logger.warning("ai_batch_no_output", count=len(items))
            return []

        results = ai_result["items"]
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
            # ★ strategic_value-sentiment 정합성 보정 (AI가 neutral 남발 시 교정)
            sval = r["strategic_value"]
            sent = r["sentiment"]
            if sval in ("strength", "threat") and sent == "neutral":
                r["sentiment"] = "positive"
                if r["sentiment_score"] == 0.0:
                    r["sentiment_score"] = 0.5
            elif sval in ("weakness", "opportunity") and sent == "neutral":
                r["sentiment"] = "negative"
                if r["sentiment_score"] == 0.0:
                    r["sentiment_score"] = -0.5
            # 무관 콘텐츠 강제 중립화
            if not r["is_relevant"]:
                r["sentiment"] = "neutral"
                r["sentiment_score"] = 0.0
                r["threat_level"] = "none"
                r["strategic_value"] = "neutral"
                r["action_type"] = "ignore"

        logger.info("ai_batch_done", input=len(items), output=len(results))
        return results

    except Exception as e:
        logger.error("ai_batch_error", error=str(e), count=len(items))
        from app.common.ai_alert import fire_and_forget_alert
        fire_and_forget_alert(e, f"배치 전략분석 실패 ({len(items)}건)")
        return []


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


_VALID_TABLES = {
    "news_articles": "summary",
    "community_posts": "content_snippet",
    "youtube_videos": "description_snippet",
}

# P2-01 race-shared 매핑 — 3매체 legacy ↔ race_*
_RACE_TABLES = {
    "news_articles": {
        "race": "race_news_articles",
        "camp": "race_news_camp_analysis",
        "match_col": "url",
        "fk_col": "race_news_id",
    },
    "community_posts": {
        "race": "race_community_posts",
        "camp": "race_community_camp_analysis",
        "match_col": "url",
        "fk_col": "race_community_id",
    },
    "youtube_videos": {
        "race": "race_youtube_videos",
        "camp": "race_youtube_camp_analysis",
        "match_col": "video_id",
        "fk_col": "race_youtube_id",
    },
}


async def _apply_ai_to_race_shared(
    db_session,
    legacy_table: str,
    legacy_id: str,
    tenant_id: str,
    r: dict,
    ai_summary: str,
    is_rel: bool,
) -> None:
    """Legacy 테이블 UPDATE 직후 대응하는 race_* 테이블에도 AI 필드 동시 반영.

    Race-level 필드 (ai_summary, sentiment 등)는 race_*_articles에,
    Camp-level 필드 (quadrant, action 등)는 race_*_camp_analysis에 UPSERT.
    실패 시 조용히 통과 (legacy 쓰기가 우선).
    """
    from sqlalchemy import text as sql_text
    info = _RACE_TABLES.get(legacy_table)
    if not info:
        return
    race_tbl = info["race"]
    camp_tbl = info["camp"]
    match_col = info["match_col"]
    fk_col = info["fk_col"]

    try:
        # 1. race row 찾기 (legacy row의 election_id + url/video_id로 JOIN)
        race_id = (await db_session.execute(sql_text(f"""
            SELECT rn.id
            FROM {race_tbl} rn
            JOIN {legacy_table} l
              ON l.election_id = rn.election_id
             AND l.{match_col} = rn.{match_col}
            WHERE l.id = :lid
        """), {"lid": legacy_id})).scalar()

        if not race_id:
            return  # race 행이 없으면 스킵 (듀얼 라이트 실패 케이스)

        # 2. race_*_articles/posts/videos 에 race-level AI 필드 갱신
        await db_session.execute(sql_text(f"""
            UPDATE {race_tbl} SET
                ai_summary = :summary,
                ai_topics = :topics,
                ai_threat_level = :threat,
                sentiment = :sentiment,
                sentiment_score = :score,
                ai_analyzed_at = NOW()
            WHERE id = :rid
        """), {
            "rid": str(race_id),
            "summary": ai_summary,
            "topics": json.dumps(r.get("topics", []), ensure_ascii=False),
            "threat": r["threat_level"],
            "sentiment": r["sentiment"],
            "score": r["sentiment_score"],
        })

        # 3. race_*_camp_analysis 에 camp-level 필드 UPSERT
        candidate_id = None
        if is_rel:
            # legacy row에서 candidate_id 가져오기
            cid = (await db_session.execute(sql_text(f"""
                SELECT candidate_id FROM {legacy_table} WHERE id = :lid
            """), {"lid": legacy_id})).scalar()
            candidate_id = str(cid) if cid else None

        await db_session.execute(sql_text(f"""
            INSERT INTO {camp_tbl} (
                {fk_col}, tenant_id, candidate_id,
                is_about_our_candidate, strategic_quadrant, strategic_value,
                action_type, action_priority, action_summary, ai_reason,
                updated_at
            )
            VALUES (
                :rid, :tid, :cid,
                :is_ours, :q, :q,
                :atype, :apri, :asum, :reason,
                NOW()
            )
            ON CONFLICT ({fk_col}, tenant_id) DO UPDATE SET
                candidate_id = EXCLUDED.candidate_id,
                is_about_our_candidate = EXCLUDED.is_about_our_candidate,
                strategic_quadrant = EXCLUDED.strategic_quadrant,
                strategic_value = EXCLUDED.strategic_value,
                action_type = EXCLUDED.action_type,
                action_priority = EXCLUDED.action_priority,
                action_summary = EXCLUDED.action_summary,
                ai_reason = EXCLUDED.ai_reason,
                updated_at = NOW()
        """), {
            "rid": str(race_id),
            "tid": str(tenant_id),
            "cid": candidate_id,
            "is_ours": r["is_about_our_candidate"],
            "q": r["strategic_value"],
            "atype": r["action_type"],
            "apri": r["action_priority"],
            "asum": (r.get("action_summary") or "")[:300],
            "reason": r.get("reason", ""),
        })
    except Exception as e:
        logger.warning("race_shared_dual_write_failed",
                       legacy_table=legacy_table, error=str(e)[:200])


async def _analyze_table_strategic(
    db_session, tenant_id: str, election_id: str,
    table: str, content_col: str, limit: int = 30, batch_size: int = 8,
) -> dict:
    """공통 batch 전략 분석 — news/community/youtube에 재사용."""
    # SQL Injection 방지
    if table not in _VALID_TABLES or content_col not in _VALID_TABLES.values():
        return {"analyzed": 0, "irrelevant": 0, "by_quadrant": {}, "error": "invalid_table"}
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
            tenant_id=tenant_id,
            db=db_session,
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
                    strategic_quadrant = :sval,
                    action_type = :atype,
                    action_priority = :apri,
                    action_summary = :asum,
                    is_about_our_candidate = :is_ours,
                    is_relevant = :is_rel,
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

            # P2-01 race-shared 듀얼 라이트 — race_*_articles + race_*_camp_analysis
            await _apply_ai_to_race_shared(
                db_session, table, item["id"], tenant_id, r, ai_summary, is_rel,
            )

            analyzed += 1

    await db_session.commit()

    # ── Opus 검증 단계 ──
    verified_count, changed_count = await _verify_with_opus(
        db_session, tenant_id, election_id, table, content_col,
    )

    return {
        "analyzed": analyzed,
        "irrelevant": irrelevant,
        "by_quadrant": by_quadrant,
        "verified": verified_count,
        "changed_by_opus": changed_count,
    }


async def _verify_with_opus(
    db_session, tenant_id: str, election_id: str,
    table: str, content_col: str, limit: int = 60,
) -> tuple[int, int]:
    """Sonnet 1차 분석 후 positive/negative 항목을 Opus로 검증 + 교정.

    neutral은 스킵 (비용 절약). 검증 완료 시 sentiment_verified=TRUE.
    Returns: (verified_count, changed_count)
    """
    if table not in _VALID_TABLES:
        return 0, 0
    from sqlalchemy import text as sql_text
    from app.analysis.sentiment import SentimentAnalyzer

    rows = (await db_session.execute(sql_text(f"""
        SELECT t.id, t.title, t.{content_col}, t.sentiment,
               t.is_about_our_candidate, c.name
        FROM {table} t
        LEFT JOIN candidates c ON t.candidate_id = c.id
        WHERE t.tenant_id = :tid AND t.election_id = :eid
          AND t.sentiment_verified = FALSE
          AND t.sentiment IN ('positive', 'negative')
          AND t.ai_analyzed_at IS NOT NULL
        ORDER BY t.ai_analyzed_at DESC
        LIMIT :lim
    """), {"tid": tenant_id, "eid": election_id, "lim": limit})).all()

    if not rows:
        return 0, 0

    items = [
        {
            "id": str(r[0]),
            "text": f"{r[1] or ''} {r[2] or ''}".strip(),
            "current_sentiment": r[3],
            "is_our_candidate": bool(r[4]),
            "candidate_name": r[5] or "",
        }
        for r in rows
    ]

    analyzer = SentimentAnalyzer()
    verified_results = await analyzer.verify_batch_with_opus(
        items, tenant_id=tenant_id, db=db_session,
    )

    verified_count = 0
    changed_count = 0
    info = _RACE_TABLES.get(table)  # race-shared 듀얼 라이트 대상

    for v in verified_results:
        quadrant_clause = ""
        params = {
            "id": v["id"],
            "s": v["sentiment"],
            "score": v["score"],
        }
        if v.get("quadrant"):
            quadrant_clause = ", strategic_value = :q, strategic_quadrant = :q"
            params["q"] = v["quadrant"]

        await db_session.execute(sql_text(f"""
            UPDATE {table} SET
                sentiment = :s,
                sentiment_score = :score{quadrant_clause},
                sentiment_verified = TRUE
            WHERE id = :id
        """), params)
        verified_count += 1
        if v.get("changed"):
            changed_count += 1

        # ── race-shared 듀얼 라이트 (Opus 검증 반영) ──
        if info:
            try:
                race_tbl = info["race"]
                camp_tbl = info["camp"]
                match_col = info["match_col"]
                fk_col = info["fk_col"]

                race_id = (await db_session.execute(sql_text(f"""
                    SELECT rn.id FROM {race_tbl} rn
                    JOIN {table} l
                      ON l.election_id = rn.election_id
                     AND l.{match_col} = rn.{match_col}
                    WHERE l.id = :lid
                """), {"lid": v["id"]})).scalar()

                if race_id:
                    # race-level: sentiment + sentiment_verified
                    await db_session.execute(sql_text(f"""
                        UPDATE {race_tbl} SET
                            sentiment = :s,
                            sentiment_score = :score,
                            sentiment_verified = TRUE
                        WHERE id = :rid
                    """), {
                        "rid": str(race_id),
                        "s": v["sentiment"],
                        "score": v["score"],
                    })
                    # camp-level: quadrant (Opus 교정 시)
                    if v.get("quadrant"):
                        await db_session.execute(sql_text(f"""
                            UPDATE {camp_tbl} SET
                                strategic_quadrant = :q,
                                strategic_value = :q,
                                updated_at = NOW()
                            WHERE {fk_col} = :rid AND tenant_id = :tid
                        """), {
                            "rid": str(race_id),
                            "tid": str(tenant_id),
                            "q": v["quadrant"],
                        })
            except Exception as e:
                logger.warning("race_shared_opus_verify_failed",
                               table=table, error=str(e)[:200])

    await db_session.commit()
    logger.info(
        "opus_verified",
        table=table, verified=verified_count, changed=changed_count,
    )
    return verified_count, changed_count



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
