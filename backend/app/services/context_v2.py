"""
Intent 기반 컨텍스트 조립 — 각 getter는 독립 세션 사용.

원칙:
1. getter마다 async_session_factory() 새 세션 — 한 곳 실패가 다른 곳 오염 불가
2. 반환은 scalar/dict/str만 — ORM 객체 절대 반환 금지 (lazy-load 원천 차단)
3. 실패하면 빈 결과 반환, 예외 버블링 안 함
4. build_context(intents=[...]) — 필요한 소스만 골라 병렬 호출

Intent 종류:
- facts:   선거+우리/상대 후보 기본 사실 (항상 포함)
- news:    주제 관련 뉴스 RAG (요청 topic 필요)
- media:   유튜브/커뮤니티 RAG
- survey:  여론조사
- profile: NEC 후보 프로필
- history: 과거 선거 결과
- memory:  캠프 이전 보고서/브리핑
- law:     공직선거법 조항
"""
from __future__ import annotations
import asyncio
from datetime import date
from typing import TypedDict
import structlog

from sqlalchemy import text as _sql
from app.database import async_session_factory

logger = structlog.get_logger()


class ElectionFacts(TypedDict, total=False):
    election_id: str
    name: str
    type: str
    sido: str
    sigungu: str
    date_iso: str | None
    d_day: int
    our: dict
    rivals: list[dict]


# ───────── getter (각자 독립 세션) ──────────

async def get_election_facts(tenant_id: str, election_id: str) -> ElectionFacts:
    """선거 + 우리후보 + 경쟁자 기본 사실. 모두 scalar dict."""
    try:
        async with async_session_factory() as db:
            row = (await db.execute(_sql("""
                SELECT e.name, e.election_type, e.region_sido, e.region_sigungu, e.election_date
                FROM elections e WHERE e.id = cast(:eid as uuid)
            """), {"eid": election_id})).first()
            if not row:
                return {}
            e_name, e_type, e_sido, e_sigungu, e_date = row

            cands = (await db.execute(_sql("""
                SELECT c.id, c.name, c.party, c.role, c.party_alignment,
                       (te.our_candidate_id = c.id) AS is_ours
                FROM candidates c
                LEFT JOIN tenant_elections te
                  ON te.election_id = c.election_id AND te.tenant_id = cast(:tid as uuid)
                WHERE c.election_id = cast(:eid as uuid) AND c.enabled = true
                ORDER BY c.priority
            """), {"tid": tenant_id, "eid": election_id})).all()

            _align_kor = {"conservative": "보수", "progressive": "진보", "centrist": "중도", "independent": "무소속"}
            our = None
            rivals = []
            for c in cands:
                d = {
                    "id": str(c[0]), "name": c[1],
                    "party": c[2] or "무소속", "role": c[3] or "",
                    "party_alignment": c[4] or "",
                    "alignment_kor": _align_kor.get(c[4] or "", "성향 미지정"),
                }
                if c[5]:
                    our = d
                else:
                    rivals.append(d)

            d_day = (e_date - date.today()).days if e_date else 0
            return {
                "election_id": election_id,
                "name": e_name or "",
                "type": e_type or "",
                "sido": e_sido or "",
                "sigungu": e_sigungu or "",
                "date_iso": e_date.isoformat() if e_date else None,
                "d_day": d_day,
                "our": our or {},
                "rivals": rivals,
            }
    except Exception as e:
        logger.warning("ctx_facts_failed", error=str(e)[:120])
        return {}


async def get_rag_block(tenant_id: str, election_id: str, query: str,
                        limit: int = 10, source_types: list[str] | None = None) -> tuple[str, list[dict]]:
    """RAG 벡터 검색 (같은 선거 공유 + 캠프 private). 독립 세션."""
    from app.services.embedding_service import search_similar
    try:
        async with async_session_factory() as db:
            rows = await search_similar(db, tenant_id, query, limit=limit,
                                        source_types=source_types, election_id=election_id)
    except Exception as e:
        logger.warning("ctx_rag_failed", error=str(e)[:120])
        return "", []

    if not rows:
        return "", []

    # 신뢰도 분리: 뉴스·보고서·브리핑 = 🟢 사실 / 유튜브·커뮤니티 = 🟡 여론
    FACT_TYPES = {"news", "report", "briefing", "content"}
    fact_rows = [r for r in rows if r.get("source_type") in FACT_TYPES]
    opinion_rows = [r for r in rows if r.get("source_type") not in FACT_TYPES]

    lines = []
    citations = []
    idx = 0

    if fact_rows:
        lines.append("=== 🟢 사실 소스 (뉴스/보고서 — 인용 가능) ===")
        for r in fact_rows:
            idx += 1
            rid = f"rag-{idx}"
            lines.append(f"[ref-{rid}] [{r['source_type']}] {r.get('title','')} (유사도 {r.get('similarity')})")
            if r.get("content"):
                lines.append(f"  {r['content']}")
            citations.append({
                "id": rid, "type": r["source_type"], "trust": "fact",
                "title": r.get("title") or "", "source_id": r.get("source_id"),
                "preview": (r.get("content") or "")[:200], "similarity": r.get("similarity"),
            })

    if opinion_rows:
        lines.append("\n=== 🟡 여론 소스 (유튜브/커뮤니티 — 감성·분위기만 참고, 수치·사실 인용 금지) ===")
        for r in opinion_rows:
            idx += 1
            rid = f"rag-{idx}"
            lines.append(f"[{rid}] [{r['source_type']}] {r.get('title','')}")
            if r.get("content"):
                # 여론은 헤드라인 위주로만
                lines.append(f"  {(r.get('content') or '')[:150]}")
            citations.append({
                "id": rid, "type": r["source_type"], "trust": "opinion",
                "title": r.get("title") or "", "source_id": r.get("source_id"),
                "preview": (r.get("content") or "")[:150], "similarity": r.get("similarity"),
            })

    return "\n".join(lines), citations


async def get_surveys_block(election_id: str, limit: int = 5) -> tuple[str, list[dict]]:
    """여론조사 최근 N건."""
    try:
        async with async_session_factory() as db:
            rows = (await db.execute(_sql("""
                SELECT id, survey_date, survey_org, sample_size, margin_of_error, results, source_url
                FROM surveys
                WHERE election_id = cast(:eid as uuid)
                ORDER BY survey_date DESC LIMIT :lim
            """), {"eid": election_id, "lim": limit})).all()
    except Exception as e:
        logger.warning("ctx_survey_failed", error=str(e)[:120])
        return "", []

    if not rows:
        return "", []

    lines = ["=== 최근 여론조사 ==="]
    citations = []
    for r in rows:
        sid_, sdate, sorg, ssize, smoe, sres, surl = r
        results = sres or {}
        parts = []
        try:
            for n, v in sorted(results.items(), key=lambda x: -float(x[1] or 0))[:6]:
                parts.append(f"{n}: {v}%")
        except Exception:
            parts = [f"{k}: {v}" for k, v in list(results.items())[:6]]
        sid_str = f"survey-{str(sid_)[:8]}"
        lines.append(f"[ref-{sid_str}] {sdate} {sorg} (N={ssize or '?'}, 오차 ±{smoe or '?'}%): {', '.join(parts)}")
        if surl:
            citations.append({
                "id": sid_str, "type": "survey",
                "title": f"{sorg} 여론조사 ({sdate})",
                "source": sorg, "url": surl,
            })
    return "\n".join(lines), citations


async def get_profiles_block(election_id: str, names: list[str] | None = None) -> tuple[str, list[dict]]:
    """NEC 후보 공식 프로필. names 지정 시 해당 후보만."""
    try:
        async with async_session_factory() as db:
            rows = (await db.execute(_sql("""
                SELECT c.id, c.name, c.party,
                       p.education, p.career, p.assets, p.military, p.crimes, p.pledges_nec, p.source_url
                FROM candidates c
                LEFT JOIN candidate_profiles p ON p.candidate_id = c.id
                WHERE c.election_id = cast(:eid as uuid) AND c.enabled = true
                ORDER BY c.priority
                LIMIT 8
            """), {"eid": election_id})).all()
    except Exception as e:
        logger.warning("ctx_profile_failed", error=str(e)[:120])
        return "", []

    lines = ["=== 후보자 공식 프로필 (info.nec.go.kr) ==="]
    citations = []
    name_set = set(names) if names else None
    has = False
    for r in rows:
        c_id, c_name, c_party, edu, car, ast, mil, cri, pl, src_url = r
        if name_set and c_name not in name_set:
            continue
        has = True
        lines.append(f"\n▶ {c_name} ({c_party or '무소속'})")
        if edu: lines.append(f"  학력: {edu}")
        if car: lines.append(f"  경력: {car[:400]}")
        if ast: lines.append(f"  재산: {ast}")
        if mil: lines.append(f"  병역: {mil}")
        if cri: lines.append(f"  전과: {cri}")
        if pl:
            try:
                items = pl if isinstance(pl, list) else []
                if items:
                    lines.append(f"  공약: {', '.join(str(x)[:60] for x in items[:5])}")
            except Exception: pass
        if src_url:
            pid = f"nec-{str(c_id)[:8]}"
            citations.append({
                "id": pid, "type": "nec",
                "title": f"{c_name} 공식 프로필",
                "source": "info.nec.go.kr", "url": src_url,
            })
    return ("\n".join(lines), citations) if has else ("", [])


async def get_history_block(election_id: str) -> tuple[str, list[dict]]:
    """과거 선거 결과 (NEC)."""
    try:
        from app.chat.context_builder import _build_history_context
        async with async_session_factory() as db:
            row = (await db.execute(_sql(
                "SELECT region_sido, election_type FROM elections WHERE id = cast(:eid as uuid)"
            ), {"eid": election_id})).first()
            if not row:
                return "", []
            # _build_history_context는 기존 함수 — Election 객체가 필요하므로 일단 SELECT으로 재구성
            from app.elections.models import Election
            from sqlalchemy import select
            election = (await db.execute(select(Election).where(Election.id == election_id))).scalar_one_or_none()
            if not election:
                return "", []
            hist = await _build_history_context(db, election_id, election)
            if hist:
                return hist, [{
                    "id": "nec-history", "type": "nec",
                    "title": f"{election.region_sido} {election.election_type} 역대 선거",
                    "source": "중앙선거관리위원회",
                }]
    except Exception as e:
        logger.warning("ctx_history_failed", error=str(e)[:120])
    return "", []


async def get_memory_block(tenant_id: str, election_id: str,
                           max_reports: int = 2, max_briefings: int = 3) -> tuple[str, list[dict]]:
    """캠프 학습 메모리 (이전 보고서/브리핑)."""
    try:
        async with async_session_factory() as db:
            from app.services.camp_context import build_camp_memory
            text_out = await build_camp_memory(
                db, tenant_id, election_id,
                max_reports=max_reports, max_briefings=max_briefings, max_content=0,
            )
            return text_out or "", []
    except Exception as e:
        logger.warning("ctx_memory_failed", error=str(e)[:120])
        return "", []


def get_law_block() -> tuple[str, list[dict]]:
    """공직선거법 주요 조항 — DB 안 탐."""
    try:
        from app.content.compliance import ComplianceChecker
        return (
            f"=== 공직선거법 주요 조항 (필수 준수) ===\n{ComplianceChecker.get_law_text()}",
            [{"id": "law", "type": "nec", "title": "공직선거법 주요 조항", "source": "국가법령정보센터"}],
        )
    except Exception:
        return "", []


# ───────── Intent 분류 ──────────

INTENT_KEYWORDS = {
    "survey":  ["지지율", "여론조사", "서베이", "support", "%"],
    "profile": ["학력", "경력", "재산", "병역", "이력", "프로필", "누구", "소개"],
    "history": ["과거 선거", "지난 선거", "역대", "직전 선거", "지역 득표"],
    "news":    ["뉴스", "기사", "최근", "이슈", "보도", "언론"],
    "media":   ["유튜브", "영상", "커뮤니티", "카페", "댓글"],
    "law":     ["선거법", "공직선거법", "허용", "금지", "위반", "합법", "불법"],
    "memory":  ["지난 보고서", "이전 분석", "지난주", "어제"],
    "compare": ["vs", "비교", "대", "차이", "누가 더"],
}


def classify_intent(text: str, include_all_default: bool = False) -> set[str]:
    """간단 키워드 매칭. 질문 모호하면 default(뉴스+프로필) 또는 전체."""
    if not text:
        return {"news", "profile"}
    t = text.lower()
    hits = set()
    for intent, kws in INTENT_KEYWORDS.items():
        if any(k in t for k in kws):
            hits.add(intent)
    if not hits:
        # 기본: 뉴스 + 프로필 (인물/이슈 관련이 가장 많음)
        hits = {"news", "profile"}
    # 비교 질문엔 두 후보 자료 모두 필요
    if "compare" in hits:
        hits.update({"profile", "news"})
    if include_all_default:
        hits.update({"facts", "news", "profile", "survey"})
    return hits


# ───────── 오케스트레이터 ──────────

async def build_context(
    tenant_id: str,
    election_id: str,
    query: str,
    *,
    intents: set[str] | None = None,
    max_rag: int = 10,
    include_law: bool = False,
) -> tuple[str, list[dict], ElectionFacts]:
    """의도에 맞는 소스만 병렬 조립.

    Returns:
        (context_text, citations, election_facts)
    """
    if intents is None:
        intents = classify_intent(query)

    # facts는 항상 포함
    facts_task = asyncio.create_task(get_election_facts(tenant_id, election_id))

    # 병렬 실행할 task들
    tasks: dict[str, asyncio.Task] = {}
    if "news" in intents or "media" in intents or "compare" in intents:
        stypes = None
        if "media" in intents and "news" not in intents:
            stypes = ["youtube", "community"]
        elif "news" in intents and "media" not in intents:
            stypes = ["news"]
        tasks["rag"] = asyncio.create_task(
            get_rag_block(tenant_id, election_id, query, limit=max_rag, source_types=stypes)
        )
    if "survey" in intents:
        tasks["survey"] = asyncio.create_task(get_surveys_block(election_id))
    if "profile" in intents or "compare" in intents:
        tasks["profile"] = asyncio.create_task(get_profiles_block(election_id))
    if "history" in intents:
        tasks["history"] = asyncio.create_task(get_history_block(election_id))
    if "memory" in intents:
        tasks["memory"] = asyncio.create_task(get_memory_block(tenant_id, election_id))

    facts = await facts_task
    results: dict[str, tuple[str, list[dict]]] = {}
    for key, task in tasks.items():
        try:
            results[key] = await task
        except Exception as e:
            logger.warning("ctx_orch_task_failed", key=key, error=str(e)[:100])
            results[key] = ("", [])

    # 조립
    sections = []
    citations = []

    if facts:
        _is_np = (facts.get("type") or "") in ("superintendent", "edu_board")

        def _fmt_r(r):
            a = r.get("alignment_kor") or "성향 미지정"
            if _is_np:
                return f"{r['name']} [무소속·정당공천금지 | 성향(등록값): {a}]"
            return f"{r['name']} [정당: {r.get('party') or '무소속'} | 성향(등록값): {a}]"

        rivals_str = ", ".join(_fmt_r(r) for r in facts.get("rivals", []))
        our = facts.get("our") or {}
        our_line = _fmt_r(our) if our else "-"
        nonpartisan_note = (
            "\n※ 정당 공천 금지 선거. 정당 프레임(○○당 강세) 사용 금지. 후보 성향은 위 '성향(등록값)'만 사실."
            if _is_np else ""
        )
        sections.append(
            f"=== 선거 기본 정보 ==={nonpartisan_note}\n"
            f"선거: {facts.get('name')} (D-{facts.get('d_day', 0)})\n"
            f"지역: {facts.get('sido','')} {facts.get('sigungu','')}\n"
            f"유형: {facts.get('type','')}\n"
            f"우리 후보: {our_line}\n"
            f"경쟁 후보: {rivals_str or '-'}\n"
            "[후보 정체성 판단 절대 규칙] 각 후보의 '성향(등록값)'은 캠프가 등록한 확정 사실이다. "
            "이름이 같은 다른 정치인(사전 학습·WebSearch 결과)과 절대 혼동하지 마라. 등록값과 반대되는 이념(보수↔진보) 서술 금지."
        )

    for key in ("rag", "survey", "profile", "history", "memory"):
        text_, cites = results.get(key, ("", []))
        if text_:
            sections.append(text_)
        citations.extend(cites)

    if include_law or "law" in intents:
        law_text, law_cites = get_law_block()
        if law_text:
            sections.append(law_text)
        citations.extend(law_cites)

    return "\n\n".join(s for s in sections if s), citations, facts
